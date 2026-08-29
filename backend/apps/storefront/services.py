"""Write side of the tenant's online-store settings.

One transaction per mutation, one audit row per change — the same contract
as ``apps.tenants.services.update_tenant_settings``. Business validation
(discount bounds) lives here, not in the serializer.
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction

from apps.audit.services import audit
from apps.storefront.models import MAX_BANNERS, MAX_OFFER_PCT, StoreSettings
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
    "offer_ends_at",
    "popup_enabled",
    "popup_title",
    "popup_text",
    "popup_cta_text",
    "popup_cta_link",
    "banners",
    "currency",
)

#: Per-banner field caps — banners are rendered as small cards, so copy must
#: stay short; links may be in-page anchors, site paths, or absolute URLs.
_BANNER_LIMITS = {"title": 120, "text": 280, "cta_text": 60, "cta_link": 200}


def _validate_link(link: str, *, what: str) -> None:
    """CTA links may be in-page anchors, site paths, or absolute URLs only —
    anything else (``javascript:`` and friends) is refused."""
    if link and not link.startswith(("#", "/", "http://", "https://")):
        raise ServiceError(
            "LINK_INVALID", f"{what} must be an anchor, a site path, or an http(s) URL."
        )


def _clean_banners(value: Any) -> list[dict[str, str]] | None:
    """Validate + normalise the promo-banner list; bad shapes are 400s."""
    if value is None:
        return None
    if not isinstance(value, list) or len(value) > MAX_BANNERS:
        raise ServiceError(
            "BANNERS_INVALID", f"Banners must be a list of at most {MAX_BANNERS} entries."
        )
    cleaned: list[dict[str, str]] = []
    for entry in value:
        if not isinstance(entry, dict):
            raise ServiceError("BANNERS_INVALID", "Each banner must be an object.")
        banner = {name: str(entry.get(name) or "").strip() for name in _BANNER_LIMITS}
        if not banner["title"]:
            raise ServiceError("BANNERS_INVALID", "Each banner needs a title.")
        for name, limit in _BANNER_LIMITS.items():
            if len(banner[name]) > limit:
                raise ServiceError(
                    "BANNERS_INVALID", f"Banner {name} must be at most {limit} characters."
                )
        _validate_link(banner["cta_link"], what="Banner links")
        cleaned.append(banner)
    return cleaned


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
    if "banners" in fields:
        fields["banners"] = _clean_banners(fields["banners"])
    if "popup_cta_link" in fields:
        _validate_link(str(fields["popup_cta_link"] or ""), what="The popup link")
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
        # AuditLog diffs serialize with plain json — Decimals go as strings,
        # dates as ISO strings; lists (banners) are already json-native.
        def one(value: Any) -> Any:
            if isinstance(value, Decimal):
                return str(value)
            if isinstance(value, date):
                return value.isoformat()
            return value

        return {k: one(v) for k, v in diff.items()}

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
