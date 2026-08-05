"""Subscription and plan-override writes for one platform-managed tenant."""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction

from apps.platformadmin.audit import audit_platform
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.permissions import require_platform_role
from apps.tenants.models import Plan, Tenant, TenantFeatureOverride, TenantSubscription
from apps.tenants.selectors import invalidate_tenant_cache
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest


def _subscription_snapshot(subscription: TenantSubscription) -> dict[str, Any]:
    return {
        "id": str(subscription.pk),
        "plan": str(subscription.plan_id),
        "period_start": subscription.period_start.isoformat(),
        "period_end": subscription.period_end.isoformat(),
        "amount_npr": str(subscription.amount_npr),
        "status": subscription.status,
        "payment_ref": subscription.payment_ref,
        "invoice_url": subscription.invoice_url,
    }


@transaction.atomic
def create_subscription(
    tenant: Tenant,
    *,
    actor: PlatformUser,
    plan: Plan,
    period_start: date,
    period_end: date,
    amount_npr: Decimal,
    status: str = TenantSubscription.Status.PENDING,
    payment_ref: str | None = None,
    invoice_url: str | None = None,
    request: "HttpRequest | None" = None,
) -> TenantSubscription:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.BILLING))
    if period_end < period_start:
        raise ServiceError("SUBSCRIPTION_PERIOD_INVALID", "Period end cannot precede its start.")
    if amount_npr < 0:
        raise ServiceError("SUBSCRIPTION_AMOUNT_INVALID", "Subscription amount cannot be negative.")
    if not plan.is_active:
        raise ServiceError("PLAN_INACTIVE", "Inactive plans cannot be assigned.", http_status=409)
    subscription = TenantSubscription.objects.create(
        tenant=tenant,
        plan=plan,
        period_start=period_start,
        period_end=period_end,
        amount_npr=amount_npr,
        status=status,
        payment_ref=payment_ref.strip() if payment_ref else None,
        invoice_url=invoice_url.strip() if invoice_url else None,
    )
    audit_platform(
        actor=actor,
        action="subscription.create",
        tenant=tenant,
        payload={"after": _subscription_snapshot(subscription)},
        request=request,
    )
    return subscription


@transaction.atomic
def update_subscription(
    subscription: TenantSubscription,
    *,
    actor: PlatformUser,
    changes: dict[str, Any],
    request: "HttpRequest | None" = None,
) -> TenantSubscription:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.BILLING))
    locked = TenantSubscription.objects.select_for_update().get(pk=subscription.pk)
    before = _subscription_snapshot(locked)
    new_status = changes.get("status", locked.status)
    if locked.status == TenantSubscription.Status.PAID and new_status != locked.status:
        raise ServiceError("SUBSCRIPTION_PAID_TERMINAL", "Paid subscriptions are terminal.", 409)
    fields = {
        key: value
        for key, value in changes.items()
        if key in {"status", "payment_ref", "invoice_url"}
    }
    for key, value in fields.items():
        setattr(locked, key, value.strip() if isinstance(value, str) else value)
    if fields:
        locked.save(update_fields=list(fields))
    after = _subscription_snapshot(locked)
    if after != before:
        audit_platform(
            actor=actor,
            action="subscription.update",
            tenant=locked.tenant,
            payload={"before": before, "after": after},
            request=request,
        )
    return locked


def _validate_override(tenant: Tenant, key: str, value: Any) -> None:
    namespace, separator, name = key.partition(".")
    values = getattr(tenant.plan, namespace, None)
    if (
        not separator
        or namespace not in {"features", "limits"}
        or not isinstance(values, dict)
        or name not in values
    ):
        raise ServiceError("FEATURE_OVERRIDE_INVALID", "Override key is not defined by this plan.")
    if namespace == "limits" and (
        isinstance(value, bool) or not isinstance(value, int) or value < 0
    ):
        raise ServiceError(
            "FEATURE_OVERRIDE_INVALID", "Limit overrides must be non-negative integers."
        )
    if namespace == "features" and (
        not isinstance(value, (bool, int)) or (isinstance(value, int) and value < 0)
    ):
        raise ServiceError("FEATURE_OVERRIDE_INVALID", "Feature overrides have an invalid value.")


@transaction.atomic
def set_feature_override(
    tenant: Tenant,
    *,
    actor: PlatformUser,
    key: str,
    value: Any,
    expires_at: datetime | None = None,
    note: str | None = None,
    request: "HttpRequest | None" = None,
) -> tuple[TenantFeatureOverride, bool]:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN,))
    normalized = key.strip()
    _validate_override(tenant, normalized, value)
    current = TenantFeatureOverride.objects.filter(tenant=tenant, key=normalized).first()
    before = (
        {
            "value": current.value,
            "expires_at": current.expires_at.isoformat() if current.expires_at else None,
            "note": current.note,
        }
        if current
        else None
    )
    override, created = TenantFeatureOverride.objects.update_or_create(
        tenant=tenant,
        key=normalized,
        defaults={
            "value": value,
            "expires_at": expires_at,
            "note": note.strip() if note else None,
        },
    )
    audit_platform(
        actor=actor,
        action="feature_override.set",
        tenant=tenant,
        payload={
            "key": normalized,
            "before": before,
            "after": {
                "value": override.value,
                "expires_at": override.expires_at.isoformat() if override.expires_at else None,
                "note": override.note,
            },
        },
        request=request,
    )
    invalidate_tenant_cache(tenant.slug)
    return override, created


@transaction.atomic
def delete_feature_override(
    override: TenantFeatureOverride,
    *,
    actor: PlatformUser,
    request: "HttpRequest | None" = None,
) -> None:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN,))
    tenant = override.tenant
    payload = {"key": override.key, "before": {"value": override.value, "note": override.note}}
    override.delete()
    audit_platform(
        actor=actor,
        action="feature_override.delete",
        tenant=tenant,
        payload=payload,
        request=request,
    )
    invalidate_tenant_cache(tenant.slug)
