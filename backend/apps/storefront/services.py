"""Write side of the tenant's online-store settings.

One transaction per mutation, one audit row per change — the same contract
as ``apps.tenants.services.update_tenant_settings``. Business validation
(discount bounds) lives here, not in the serializer.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction

from apps.audit.services import audit
from apps.storefront.models import MAX_OFFER_PCT, StoreSettings
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_EDITABLE_FIELDS = (
    "hero_title",
    "hero_subtitle",
    "announcement",
    "offer_text",
    "offer_discount_pct",
    "currency",
)


def get_or_create_settings(tenant: "Tenant") -> StoreSettings:
    """Fetch the tenant's store settings row, creating defaults on first use."""
    settings_row, _ = StoreSettings.objects.get_or_create(tenant=tenant)
    return settings_row


@transaction.atomic
def update_settings(
    tenant: "Tenant",
    *,
    actor: "User",
    request: "HttpRequest | None" = None,
    **fields: Any,
) -> StoreSettings:
    """Apply the changed fields and record one audited diff in the same transaction."""
    settings_row = get_or_create_settings(tenant)
    changes = {
        name: value
        for name, value in fields.items()
        if name in _EDITABLE_FIELDS and value != getattr(settings_row, name)
    }
    pct = changes.get("offer_discount_pct")
    if pct is not None and not Decimal(0) < pct <= Decimal(MAX_OFFER_PCT):
        raise ServiceError(
            "DISCOUNT_OUT_OF_RANGE",
            f"Offer discount must be between 0 and {MAX_OFFER_PCT} percent.",
        )
    if not changes:
        return settings_row

    before = {name: getattr(settings_row, name) for name in changes}
    for name, value in changes.items():
        setattr(settings_row, name, value)
    settings_row.save(update_fields=[*changes, "updated_at"])

    def _jsonable(diff: dict[str, Any]) -> dict[str, Any]:
        # AuditLog diffs serialize with plain json — Decimals must go as strings.
        return {k: str(v) if isinstance(v, Decimal) else v for k, v in diff.items()}

    audit(
        tenant,
        actor=actor,
        action="store.settings.update",
        target_type="store_settings",
        target_id=settings_row,
        before=_jsonable(before),
        after=_jsonable(changes),
        request=request,
    )
    return settings_row
