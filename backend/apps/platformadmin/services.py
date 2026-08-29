"""Write-side authentication and control-plane business rules."""

import re
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.platformadmin.audit import audit_platform
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.permissions import require_platform_role
from apps.platformadmin.totp import verify_totp
from apps.tenants.constants import TenantStatus
from apps.tenants.models import (
    Plan,
    Tenant,
)
from apps.tenants.selectors import invalidate_tenant_cache
from apps.tenants.services import validate_shopfront_subdomain
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

_DUMMY_PASSWORD_HASH: Final = make_password("platform-auth-timing-placeholder")


class PlatformAuthError(Exception):
    def __init__(self, code: str, message: str, *, http_status: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@transaction.atomic
def authenticate_platform_user(email: str, password: str, otp: str) -> PlatformUser:
    """Require an active platform user, password, and configured TOTP."""
    invalid = PlatformAuthError(
        "INVALID_CREDENTIALS",
        "Email, password, or authentication code is incorrect.",
    )
    user = PlatformUser.objects.filter(email__iexact=email.strip()).first()
    if user is None or not user.is_active:
        check_password(password, _DUMMY_PASSWORD_HASH)
        raise invalid
    if not user.check_password(password):
        raise invalid
    if not user.totp_secret:
        raise PlatformAuthError(
            "TWO_FACTOR_NOT_CONFIGURED",
            "Two-factor authentication must be configured before admin login.",
            http_status=403,
        )
    if not verify_totp(user.totp_secret, otp):
        raise invalid
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at"])
    return user


def _required(value: str, label: str) -> str:
    clean = value.strip()
    if not clean:
        raise ServiceError("VALIDATION_ERROR", f"{label} is required.")
    return clean


def _validate_plan_config(
    *,
    price_npr: Decimal | None = None,
    limits: dict[str, Any] | None = None,
    features: dict[str, Any] | None = None,
) -> None:
    invalid_limits = limits is not None and (
        not isinstance(limits, dict)
        or any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in limits.values()
        )
    )
    invalid_features = features is not None and (
        not isinstance(features, dict)
        or any(
            not isinstance(value, bool)
            and (not isinstance(value, int) or isinstance(value, bool) or value < 0)
            for value in features.values()
        )
    )
    if (price_npr is not None and price_npr < 0) or invalid_limits or invalid_features:
        raise ServiceError(
            "PLAN_CONFIGURATION_INVALID",
            "Plan prices and limits must be non-negative; features must be booleans or limits.",
        )


def _plan_snapshot(plan: Plan) -> dict[str, Any]:
    return {
        "code": plan.code,
        "name": plan.name,
        "price_npr": str(plan.price_npr),
        "billing_cycle": plan.billing_cycle,
        "limits": plan.limits,
        "features": plan.features,
        "is_active": plan.is_active,
        "sort_order": plan.sort_order,
    }


def _invalidate_slugs(slugs: list[str]) -> None:
    for slug in slugs:
        invalidate_tenant_cache(slug)


@transaction.atomic
def create_plan(
    *,
    actor: PlatformUser,
    code: str,
    name: str,
    price_npr: Decimal,
    billing_cycle: str,
    limits: dict[str, Any],
    features: dict[str, Any],
    is_active: bool = True,
    sort_order: int = 0,
    request: "HttpRequest | None" = None,
) -> Plan:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN,))
    normalized_code = code.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,31}", normalized_code):
        raise ServiceError(
            "PLAN_CONFIGURATION_INVALID",
            "Plan code must contain 2–32 lowercase letters, numbers, or hyphens.",
        )
    _validate_plan_config(price_npr=price_npr, limits=limits, features=features)
    try:
        plan = Plan.objects.create(
            code=normalized_code,
            name=_required(name, "Plan name"),
            price_npr=price_npr,
            billing_cycle=billing_cycle,
            limits=limits,
            features=features,
            is_active=is_active,
            sort_order=sort_order,
        )
    except IntegrityError as exc:
        raise ServiceError("ALREADY_EXISTS", "A plan with this code already exists.", 409) from exc
    audit_platform(
        actor=actor,
        action="plan.create",
        payload={"after": _plan_snapshot(plan)},
        request=request,
    )
    return plan


@transaction.atomic
def update_plan(
    plan: Plan,
    *,
    actor: PlatformUser,
    changes: dict[str, Any],
    request: "HttpRequest | None" = None,
) -> Plan:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN,))
    locked = Plan.objects.select_for_update().get(pk=plan.pk)
    before = _plan_snapshot(locked)
    _validate_plan_config(
        price_npr=changes.get("price_npr"),
        limits=changes.get("limits"),
        features=changes.get("features"),
    )
    fields = {
        key: value
        for key, value in changes.items()
        if key
        in {"name", "price_npr", "billing_cycle", "limits", "features", "is_active", "sort_order"}
    }
    if "name" in fields:
        fields["name"] = _required(fields["name"], "Plan name")
    for key, value in fields.items():
        setattr(locked, key, value)
    if fields:
        locked.save(update_fields=list(fields))
    after = _plan_snapshot(locked)
    if after != before:
        audit_platform(
            actor=actor,
            action="plan.update",
            payload={"before": before, "after": after},
            request=request,
        )
        slugs = list(Tenant.objects.filter(plan=locked).values_list("slug", flat=True))
        _invalidate_slugs(slugs)
    return locked


def _tenant_snapshot(tenant: Tenant) -> dict[str, Any]:
    return {
        "name": tenant.name,
        "name_np": tenant.name_np,
        "legal_name": tenant.legal_name,
        "pan_vat_no": tenant.pan_vat_no,
        "vat_registered": tenant.vat_registered,
        "plan": str(tenant.plan_id),
        "status": tenant.status,
        "trial_ends_at": tenant.trial_ends_at.isoformat() if tenant.trial_ends_at else None,
        "calendar_pref": tenant.calendar_pref,
        "locale": tenant.locale,
        "currency": tenant.currency,
        "shopfront_subdomain": tenant.shopfront_subdomain,
    }


@transaction.atomic
def update_tenant(
    tenant: Tenant,
    *,
    actor: PlatformUser,
    changes: dict[str, Any],
    request: "HttpRequest | None" = None,
) -> Tenant:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN,))
    locked = Tenant.objects.select_for_update().select_related("plan").get(pk=tenant.pk)
    before = _tenant_snapshot(locked)
    fields = {
        key: value
        for key, value in changes.items()
        if key
        in {
            "name",
            "name_np",
            "legal_name",
            "pan_vat_no",
            "vat_registered",
            "plan",
            "status",
            "trial_ends_at",
            "calendar_pref",
            "locale",
            "currency",
            "shopfront_subdomain",
        }
    }
    if "plan" in fields and not fields["plan"].is_active:
        raise ServiceError("PLAN_INACTIVE", "Inactive plans cannot be assigned.", http_status=409)
    if "name" in fields:
        fields["name"] = _required(fields["name"], "Shop name")
    if "shopfront_subdomain" in fields:
        raw = fields["shopfront_subdomain"]
        fields["shopfront_subdomain"] = (
            None
            if raw is None or not str(raw).strip()
            else validate_shopfront_subdomain(str(raw), tenant_id=locked.pk)
        )
    status = fields.get("status", locked.status)
    trial_end = fields.get("trial_ends_at", locked.trial_ends_at)
    if status == TenantStatus.TRIAL and (trial_end is None or trial_end <= timezone.now()):
        raise ServiceError("TRIAL_END_REQUIRED", "A trial tenant requires a future trial end time.")
    if status != TenantStatus.TRIAL and "status" in fields:
        fields["trial_ends_at"] = None
    for key, value in fields.items():
        setattr(locked, key, value)
    if fields:
        locked.save(update_fields=list(fields))
    after = _tenant_snapshot(locked)
    if after != before:
        audit_platform(
            actor=actor,
            action="tenant.update",
            tenant=locked,
            payload={"before": before, "after": after},
            request=request,
        )
        invalidate_tenant_cache(locked.slug)
    return locked
