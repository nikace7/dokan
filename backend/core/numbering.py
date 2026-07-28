"""Gapless number sequences — IRD-compliant invoice numbering.

Contract (docs/SYSTEM_DESIGN.md §0, §3.2):

- Invoice numbers must be gapless per (tenant, branch, doc_type,
  fiscal_year_bs). Postgres sequences leave gaps on rollback, so allocation
  goes through a ``number_sequence`` row locked with ``SELECT ... FOR
  UPDATE`` inside the caller's transaction: if the sale rolls back, the
  number rolls back with it and the next caller reuses it.
- The ``number_sequence`` table is created by the operations app migration
  (``feat(sales)``). Until then, calling :func:`allocate_number` fails with a
  database error — loudly, at the exact call site.

Table contract::

    number_sequence(id, tenant_id, branch_id, doc_type, fiscal_year_bs,
                    prefix, next_number,
                    UNIQUE(tenant_id, branch_id, doc_type, fiscal_year_bs))
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from django.db import transaction

if TYPE_CHECKING:
    from django.db.backends.base.base import BaseDatabaseWrapper


def allocate_number(
    connection: BaseDatabaseWrapper,
    *,
    tenant_id: UUID | str,
    branch_id: UUID | str,
    doc_type: str,
    fiscal_year_bs: str,
    prefix: str,
) -> int:
    """Allocate and return the next gapless number for a document stream.

    Row-locks the matching ``number_sequence`` row (creating it at 1 if
    absent), increments ``next_number``, and returns the allocated value.
    Must be called inside the same transaction as the document insert so a
    rollback releases the number.
    """
    if not connection.in_atomic_block:
        msg = "allocate_number must run inside a transaction (gapless guarantee)."
        raise transaction.TransactionManagementError(msg)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO number_sequence
                (tenant_id, branch_id, doc_type, fiscal_year_bs, prefix, next_number)
            VALUES (%s, %s, %s, %s, %s, 2)
            ON CONFLICT (tenant_id, branch_id, doc_type, fiscal_year_bs)
            DO NOTHING
            """,
            [str(tenant_id), str(branch_id), doc_type, fiscal_year_bs, prefix],
        )
        cursor.execute(
            """
            SELECT next_number FROM number_sequence
            WHERE tenant_id = %s AND branch_id = %s
              AND doc_type = %s AND fiscal_year_bs = %s
            FOR UPDATE
            """,
            [str(tenant_id), str(branch_id), doc_type, fiscal_year_bs],
        )
        row = cursor.fetchone()
        if row is None:  # pragma: no cover - unreachable after the upsert
            msg = "number_sequence row missing immediately after upsert."
            raise RuntimeError(msg)
        allocated = int(row[0]) - 1
        cursor.execute(
            """
            UPDATE number_sequence SET next_number = next_number + 1
            WHERE tenant_id = %s AND branch_id = %s
              AND doc_type = %s AND fiscal_year_bs = %s
            """,
            [str(tenant_id), str(branch_id), doc_type, fiscal_year_bs],
        )
    return allocated
