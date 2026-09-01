"""Concurrency test: two threads mutating the same (branch, variant).

The row-lock contract (SELECT ... FOR UPDATE on the stock_level row) must
serialize concurrent postings so final qty_on_hand and every balance_after
are consistent — no lost updates, no corrupted running balance.

Runs as a transaction=True test: setup data is committed so both worker
connections see it; each thread gets its own Django connection.
"""

import threading
from decimal import Decimal
from typing import Any

import pytest
from django.db import connections

from apps.inventory import services
from apps.inventory.models import StockLevel, StockMovement
from tests.factories import (
    BranchFactory,
    ItemVariantFactory,
    TenantFactory,
    UserFactory,
)

# transaction=True: setup data is committed so both worker connections see
# it. serialized_rollback=True reloads the initial data (the permission
# catalog seeded by data migration) that the post-test flush would wipe.
pytestmark = pytest.mark.django_db(transaction=True, serialized_rollback=True)


def test_concurrent_adjustments_stay_consistent() -> None:
    tenant = TenantFactory()
    branch = BranchFactory(tenant=tenant)
    variant = ItemVariantFactory(tenant=tenant)
    user = UserFactory(tenant=tenant)
    services.post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        # The withdrawal worker may legally acquire all ten row locks before
        # the deposit worker. Start with enough stock for that serialization
        # so this test measures lost updates, not the insufficient-stock rule.
        qty=Decimal("30"),
        unit_cost=Decimal("100"),
        created_by=user,
    )

    barrier = threading.Barrier(3)  # both workers + main thread
    errors: list[BaseException] = []

    def work(delta: str) -> None:
        try:
            barrier.wait(timeout=10)  # release both threads together
            for _ in range(10):  # 10 postings per thread = real interleaving
                services.adjust_stock(
                    tenant,
                    branch=branch,
                    variant=variant,
                    qty_delta=Decimal(delta),
                    reason="concurrency test",
                    created_by=user,
                )
        except BaseException as exc:
            errors.append(exc)
        finally:
            connections["default"].close()  # release this thread's connection

    thread_a = threading.Thread(target=work, args=("5",))
    thread_b = threading.Thread(target=work, args=("-3",))
    thread_a.start()
    thread_b.start()
    barrier.wait(timeout=10)
    # Generous joins: this box's Docker I/O is slow; a short timeout would
    # assert while workers are still mid-flight (a fake failure). A real
    # deadlock still fails loudly after five minutes.
    thread_a.join(timeout=300)
    thread_b.join(timeout=300)

    assert not thread_a.is_alive() and not thread_b.is_alive(), "worker deadlocked"
    assert not errors, f"worker thread failed: {errors[0]!r}"

    level = StockLevel.objects.get(tenant=tenant, branch=branch, variant=variant)
    # 30 + (10 × +5) + (10 × −3) = 50
    assert level.qty_on_hand == Decimal("50")

    # Every ledger row's balance_after must be consistent with a serial
    # execution: starting from the OPENING balance, there must EXIST an
    # ordering of the adjustment rows where each balance_after equals the
    # running total after its own delta (greedy chain reconstruction).
    movements: list[Any] = list(
        StockMovement.objects.filter(tenant=tenant, branch=branch, variant=variant)
        .order_by("created_at")
        .values_list("qty_delta", "balance_after")
    )
    assert len(movements) == 21  # 1 opening + 20 adjustments
    assert movements[0] == (Decimal("30"), Decimal("30"))

    remaining = [(int(d), int(b)) for d, b in movements[1:]]
    state = 30
    while remaining:
        for pair in remaining:
            if state + pair[0] == pair[1]:
                state = pair[1]
                remaining.remove(pair)
                break
        else:
            raise AssertionError(f"ledger is not serializable from state {state}: {remaining}")
    assert state == 50  # chain ends exactly at the projection's qty_on_hand
