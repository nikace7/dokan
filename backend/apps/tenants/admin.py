"""Django admin registrations for tenants (platform-scope ops tooling)."""

from django.contrib import admin
from django.http import HttpRequest

from apps.tenants.models import (
    Branch,
    Plan,
    Tenant,
    TenantFeatureOverride,
    TenantSubscription,
    TenantUsageSnapshot,
)


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "price_npr", "billing_cycle", "is_active", "sort_order")
    list_filter = ("is_active", "billing_cycle")


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "status", "plan", "created_at")
    list_filter = ("status", "plan")
    search_fields = ("slug", "name", "legal_name")
    readonly_fields = ("created_at",)

    def get_readonly_fields(
        self, request: HttpRequest, obj: Tenant | None = None
    ) -> tuple[str, ...]:
        # Slugs are immutable after creation (docs/MULTI_TENANCY.md §7).
        readonly = (*super().get_readonly_fields(request, obj),)
        return (*readonly, "slug") if obj is not None else readonly


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "tenant", "is_default", "is_active")
    list_filter = ("is_active",)


@admin.register(TenantSubscription)
class TenantSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("tenant", "plan", "period_start", "period_end", "amount_npr", "status")
    list_filter = ("status",)


@admin.register(TenantFeatureOverride)
class TenantFeatureOverrideAdmin(admin.ModelAdmin):
    list_display = ("tenant", "key", "expires_at")


@admin.register(TenantUsageSnapshot)
class TenantUsageSnapshotAdmin(admin.ModelAdmin):
    list_display = ("tenant", "date", "users", "items", "invoices_mtd")
    list_filter = ("date",)
