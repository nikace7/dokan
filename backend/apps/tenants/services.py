"""Write-side tenant settings, plan limits, and usage reconciliation."""

import uuid
from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any, Literal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.audit.services import audit
from apps.tenants.constants import TenantStatus
from apps.tenants.models import (
    Branch,
    Plan,
    Tenant,
    TenantUsageSnapshot,
    validate_shopfront_slug,
)
from apps.tenants.selectors import get_effective_plan_value, invalidate_tenant_cache
from core.responses import ServiceError

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
    "currency",
)


def _plan_limit(
    tenant: Tenant,
    key: str,
    *,
    namespace: Literal["features", "limits"] = "limits",
) -> int | None:
    value = get_effective_plan_value(tenant, namespace, key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ServiceError(
            "PLAN_CONFIGURATION_ERROR",
            "This shop's plan is configured incorrectly. Please contact support.",
            http_status=500,
        )
    return value


def require_plan_feature(tenant: Tenant, key: str) -> None:
    """Fail closed when a write path uses a feature outside the tenant plan."""
    from apps.tenants.selectors import is_feature_enabled

    if not is_feature_enabled(tenant, key):
        raise ServiceError(
            "PLAN_FEATURE_REQUIRED",
            "This feature is not included in your current plan. Upgrade to use it.",
            http_status=402,
        )


def enforce_creation_limit(
    tenant: Tenant,
    *,
    key: str,
    queryset: QuerySet[Any],
    label: str,
    namespace: Literal["features", "limits"] = "limits",
) -> None:
    """Serialize creates per tenant and hard-block when the configured cap is full."""
    limit = _plan_limit(tenant, key, namespace=namespace)
    if limit is None:
        return
    Tenant.objects.select_for_update().only("pk").get(pk=tenant.pk)
    if queryset.count() >= limit:
        raise ServiceError(
            "PLAN_LIMIT_REACHED",
            f"Your plan allows up to {limit} {label}. Upgrade your plan to add more.",
            http_status=402,
        )


def _month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, next_month


def _month_datetime_bounds(day: date) -> tuple[datetime, datetime]:
    start, end = _month_bounds(day)
    tz = timezone.get_current_timezone()
    return (
        timezone.make_aware(datetime.combine(start, time.min), tz),
        timezone.make_aware(datetime.combine(end, time.min), tz),
    )


def get_current_usage(tenant: Tenant, key: str, *, day: date | None = None) -> int:
    """Return live monthly usage for soft warnings and hard consumable quotas."""
    from apps.notifications.models import SmsLog
    from apps.sales.models import SalesInvoice

    today = day or timezone.localdate()
    start, end = _month_bounds(today)
    if key == "max_invoices_per_month":
        return SalesInvoice.objects.filter(
            tenant=tenant,
            doc_type=SalesInvoice.DocType.SALE,
            status=SalesInvoice.Status.COMPLETED,
            business_date_ad__gte=start,
            business_date_ad__lt=end,
        ).count()
    if key == "sms_credits_per_month":
        start_at, end_at = _month_datetime_bounds(today)
        return SmsLog.objects.filter(
            tenant=tenant,
            created_at__gte=start_at,
            created_at__lt=end_at,
        ).count()
    raise ServiceError(
        "PLAN_CONFIGURATION_ERROR",
        "This shop's plan usage key is configured incorrectly. Please contact support.",
        http_status=500,
    )


def enforce_monthly_usage_limit(tenant: Tenant, *, key: str, label: str) -> None:
    """Hard-block a consumable monthly quota without affecting invoice volume."""
    limit = _plan_limit(tenant, key)
    if limit is None:
        return
    Tenant.objects.select_for_update().only("pk").get(pk=tenant.pk)
    if get_current_usage(tenant, key) >= limit:
        raise ServiceError(
            "PLAN_LIMIT_REACHED",
            f"Your plan's monthly {label} limit is used. Upgrade to add more.",
            http_status=402,
        )


def get_usage_warning(tenant: Tenant, key: str) -> tuple[str, int, int] | None:
    """Return an 80%/100% warning tuple; invoice volume is never blocked."""
    limit = _plan_limit(tenant, key)
    if limit is None:
        return None
    usage = get_current_usage(tenant, key)
    if usage >= limit:
        return "PLAN_USAGE_WARNING_100", usage, limit
    if usage * 100 >= limit * 80:
        return "PLAN_USAGE_WARNING_80", usage, limit
    return None


@transaction.atomic
def reconcile_tenant_usage(tenant: Tenant, *, day: date | None = None) -> TenantUsageSnapshot:
    """Upsert one daily usage snapshot for billing and the platform dashboard."""
    from apps.accounts.models import User
    from apps.catalog.models import Item

    snapshot_date = day or timezone.localdate()
    # ponytail: uploads do not exist yet; aggregate stored media bytes when they land.
    values = {
        "users": User.objects.filter(tenant=tenant, is_active=True).count(),
        "items": Item.objects.filter(tenant=tenant, is_active=True).count(),
        "invoices_mtd": get_current_usage(tenant, "max_invoices_per_month", day=snapshot_date),
        "storage_mb": 0,
        "sms_used": get_current_usage(tenant, "sms_credits_per_month", day=snapshot_date),
    }
    snapshot, _ = TenantUsageSnapshot.objects.update_or_create(
        tenant=tenant,
        date=snapshot_date,
        defaults=values,
    )
    return snapshot


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


def _required_platform_text(value: str, label: str) -> str:
    clean = value.strip()
    if not clean:
        raise ServiceError("TENANT_INVALID", f"{label} is required.")
    return clean


@transaction.atomic
def validate_shopfront_subdomain(candidate: str, *, tenant_id: uuid.UUID | None = None) -> str:
    """Normalise and validate an online-store subdomain.

    Collision-checked against BOTH tenant slugs and other shopfronts — the
    two namespaces share one wildcard host, so they must never overlap.
    ``tenant_id`` excludes the tenant being updated from the clash check.
    """
    value = candidate.strip().lower()
    try:
        validate_shopfront_slug(value)
    except ValidationError as exc:
        raise ServiceError("SHOPFRONT_INVALID", "; ".join(exc.messages)) from exc
    clashes = Tenant.objects.filter(Q(slug=value) | Q(shopfront_subdomain=value))
    if tenant_id is not None:
        clashes = clashes.exclude(pk=tenant_id)
    if clashes.exists():
        raise ServiceError(
            "SHOPFRONT_TAKEN", "This online-store address is already in use.", http_status=409
        )
    return value


def create_platform_tenant(
    *,
    plan: Plan,
    slug: str,
    name: str,
    status: str,
    trial_ends_at: datetime | None,
    name_np: str | None = None,
    legal_name: str | None = None,
    pan_vat_no: str | None = None,
    vat_registered: bool = False,
    calendar_pref: str = Tenant.CalendarPref.BS,
    locale: str = Tenant.Locale.NP,
    currency: str = Tenant.Currency.NPR,
) -> Tenant:
    """Create the platform row before the orchestrator opens tenant RLS context."""
    if not plan.is_active:
        raise ServiceError("PLAN_INACTIVE", "Inactive plans cannot be assigned.", http_status=409)
    if status == TenantStatus.TRIAL and (trial_ends_at is None or trial_ends_at <= timezone.now()):
        raise ServiceError("TRIAL_END_REQUIRED", "A trial tenant requires a future trial end time.")
    normalized_slug = slug.strip().lower()
    # A slug must never shadow another tenant's online-store address — both
    # resolve on the same wildcard host.
    if Tenant.objects.filter(shopfront_subdomain=normalized_slug).exists():
        raise ServiceError("ALREADY_EXISTS", "This shop subdomain is already in use.", 409)
    tenant = Tenant(
        slug=normalized_slug,
        name=_required_platform_text(name, "Shop name"),
        name_np=name_np.strip() if name_np else None,
        legal_name=legal_name.strip() if legal_name else None,
        pan_vat_no=pan_vat_no.strip() if pan_vat_no else None,
        vat_registered=vat_registered,
        plan=plan,
        status=status,
        trial_ends_at=trial_ends_at,
        calendar_pref=calendar_pref,
        locale=locale,
        currency=currency,
    )
    try:
        tenant.full_clean()
        tenant.save()
    except ValidationError as exc:
        if Tenant.objects.filter(slug=tenant.slug).exists():
            raise ServiceError(
                "ALREADY_EXISTS", "This shop subdomain is already in use.", 409
            ) from exc
        raise ServiceError("TENANT_INVALID", "; ".join(exc.messages)) from exc
    except IntegrityError as exc:
        raise ServiceError("ALREADY_EXISTS", "This shop subdomain is already in use.", 409) from exc
    return tenant


def create_default_branch(tenant: Tenant, *, code: str, name: str) -> Branch:
    """Create the mandatory first branch after tenant RLS context is set."""
    return Branch.objects.create(
        tenant=tenant,
        code=_required_platform_text(code, "Branch code").upper(),
        name=_required_platform_text(name, "Branch name"),
        is_default=True,
    )
