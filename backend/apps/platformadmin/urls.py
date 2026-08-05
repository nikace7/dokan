"""Platform-admin routes; all are additionally protected by host/IP middleware."""

from django.urls import path

from apps.platformadmin.views import (
    FeatureOverrideDetailView,
    FeatureOverrideListView,
    PlanDetailView,
    PlanListView,
    PlatformAuditListView,
    PlatformMeView,
    PlatformTokenObtainView,
    PlatformTokenRefreshView,
    SubscriptionDetailView,
    SubscriptionListView,
    TenantDetailView,
    TenantListView,
    TenantUsageView,
)

urlpatterns = [
    path("admin/auth/token", PlatformTokenObtainView.as_view(), name="platform-token"),
    path(
        "admin/auth/token/refresh",
        PlatformTokenRefreshView.as_view(),
        name="platform-token-refresh",
    ),
    path("admin/auth/me", PlatformMeView.as_view(), name="platform-me"),
    path("admin/plans", PlanListView.as_view(), name="platform-plan-list"),
    path("admin/plans/<uuid:pk>", PlanDetailView.as_view(), name="platform-plan-detail"),
    path("admin/tenants", TenantListView.as_view(), name="platform-tenant-list"),
    path(
        "admin/tenants/<uuid:pk>",
        TenantDetailView.as_view(),
        name="platform-tenant-detail",
    ),
    path(
        "admin/tenants/<uuid:tenant_pk>/subscriptions",
        SubscriptionListView.as_view(),
        name="platform-subscription-list",
    ),
    path(
        "admin/tenants/<uuid:tenant_pk>/subscriptions/<uuid:pk>",
        SubscriptionDetailView.as_view(),
        name="platform-subscription-detail",
    ),
    path(
        "admin/tenants/<uuid:tenant_pk>/usage",
        TenantUsageView.as_view(),
        name="platform-tenant-usage",
    ),
    path(
        "admin/tenants/<uuid:tenant_pk>/overrides",
        FeatureOverrideListView.as_view(),
        name="platform-feature-override-list",
    ),
    path(
        "admin/tenants/<uuid:tenant_pk>/overrides/<uuid:pk>",
        FeatureOverrideDetailView.as_view(),
        name="platform-feature-override-detail",
    ),
    path("admin/audit", PlatformAuditListView.as_view(), name="platform-audit-list"),
]
