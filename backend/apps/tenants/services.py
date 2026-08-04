"""Write-side tenant settings operations."""

from typing import TYPE_CHECKING, Any

from django.db import transaction

from apps.audit.services import audit
from apps.tenants.models import Tenant
from apps.tenants.selectors import invalidate_tenant_cache

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.accounts.models import User

_EDITABLE_FIELDS = (
    "name",
    "name_np",
    "legal_name",
    "pan_vat_no",
    "vat_registered",
    "calendar_pref",
    "locale",
)


@transaction.atomic
def update_tenant_settings(
    tenant: Tenant,
    *,
    actor: "User",
    request: "HttpRequest | None" = None,
    **fields: Any,
) -> Tenant:
    """Update the profile and record one audited diff in the same transaction."""
    changes = {
        name: value
        for name, value in fields.items()
        if name in _EDITABLE_FIELDS and value != getattr(tenant, name)
    }
    if not changes:
        return tenant

    before = {name: getattr(tenant, name) for name in changes}
    for name, value in changes.items():
        setattr(tenant, name, value)
    tenant.save(update_fields=list(changes))
    audit(
        tenant,
        actor=actor,
        action="tenant.settings.update",
        target_type="tenant",
        target_id=tenant,
        before=before,
        after=changes,
        request=request,
    )
    invalidate_tenant_cache(tenant.slug)
    return tenant
