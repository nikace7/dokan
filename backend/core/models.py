"""Abstract base models for the whole codebase.

``TenantScopedModel`` is the base for every tenant-owned table: it carries
the ``tenant`` FK that Postgres RLS policies match on. Platform-scope tables
(``tenant``, ``plan``, ``platform_user``) deliberately do NOT inherit it —
they live outside RLS and are reachable only from the super-admin service.
"""

from django.db import models


class TimeStampedModel(models.Model):
    """Abstract base with creation/update audit timestamps."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantScopedModel(TimeStampedModel):
    """Abstract base for tenant-owned rows.

    Every concrete subclass gets a ``tenant_id`` column. RLS policies compare
    it against ``current_setting('app.tenant_id')`` — see ``core/db/rls.py``.
    Every composite index on a subclass must lead with ``tenant_id``.
    """

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="+",
    )

    class Meta:
        abstract = True
