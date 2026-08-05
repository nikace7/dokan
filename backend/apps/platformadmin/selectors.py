"""Read-side queries for the isolated platform control plane."""

from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import Q, QuerySet

from apps.platformadmin.models import PlatformAuditLog
from apps.tenants.models import (
    Plan,
    Tenant,
    TenantFeatureOverride,
    TenantSubscription,
    TenantUsageSnapshot,
)
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.platformadmin.models import PlatformUser


def list_plans(actor: "PlatformUser", *, include_inactive: bool = False) -> QuerySet[Plan]:
    qs = Plan.objects.all()
    return qs if include_inactive else qs.filter(is_active=True)


def get_plan(actor: "PlatformUser", pk: UUID) -> Plan:
    plan = Plan.objects.filter(pk=pk).first()
    if plan is None:
        raise ServiceError("NOT_FOUND", "Plan not found.", http_status=404)
    return plan


def list_tenants(
    actor: "PlatformUser",
    *,
    status: str = "",
    search: str = "",
    plan_id: UUID | None = None,
) -> QuerySet[Tenant]:
    qs = Tenant.objects.filter(deleted_at__isnull=True).select_related("plan")
    if status:
        qs = qs.filter(status=status)
    if search:
        qs = qs.filter(
            Q(slug__icontains=search) | Q(name__icontains=search) | Q(legal_name__icontains=search)
        )
    if plan_id:
        qs = qs.filter(plan_id=plan_id)
    return qs.order_by("name", "slug")


def get_tenant(actor: "PlatformUser", pk: UUID) -> Tenant:
    tenant = Tenant.objects.filter(pk=pk, deleted_at__isnull=True).select_related("plan").first()
    if tenant is None:
        raise ServiceError("NOT_FOUND", "Tenant not found.", http_status=404)
    return tenant


def list_subscriptions(tenant: Tenant, actor: "PlatformUser") -> QuerySet[TenantSubscription]:
    return (
        TenantSubscription.objects.filter(tenant=tenant)
        .select_related("plan")
        .order_by("-period_start", "-id")
    )


def get_subscription(tenant: Tenant, actor: "PlatformUser", pk: UUID) -> TenantSubscription:
    subscription = (
        TenantSubscription.objects.filter(tenant=tenant, pk=pk).select_related("plan").first()
    )
    if subscription is None:
        raise ServiceError("NOT_FOUND", "Subscription not found.", http_status=404)
    return subscription


def list_usage(tenant: Tenant, actor: "PlatformUser") -> QuerySet[TenantUsageSnapshot]:
    return TenantUsageSnapshot.objects.filter(tenant=tenant).order_by("-date")


def list_feature_overrides(
    tenant: Tenant, actor: "PlatformUser"
) -> QuerySet[TenantFeatureOverride]:
    return TenantFeatureOverride.objects.filter(tenant=tenant).order_by("key")


def get_feature_override(tenant: Tenant, actor: "PlatformUser", pk: UUID) -> TenantFeatureOverride:
    override = TenantFeatureOverride.objects.filter(tenant=tenant, pk=pk).first()
    if override is None:
        raise ServiceError("NOT_FOUND", "Feature override not found.", http_status=404)
    return override


def list_platform_audit(
    actor: "PlatformUser",
    *,
    tenant_id: UUID | None = None,
    action: str = "",
    platform_user_id: UUID | None = None,
) -> QuerySet[PlatformAuditLog]:
    qs = PlatformAuditLog.objects.select_related("actor", "tenant")
    if tenant_id:
        qs = qs.filter(tenant_id=tenant_id)
    if action:
        qs = qs.filter(action=action)
    if platform_user_id:
        qs = qs.filter(actor_id=platform_user_id)
    return qs.order_by("-created_at")
