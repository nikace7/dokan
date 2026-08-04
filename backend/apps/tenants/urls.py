"""URL routes for tenant-scoped metadata and platform tenant operations."""

from django.urls import path

from apps.tenants.views import BranchListView, TenantSettingsView

urlpatterns = [
    path("settings", TenantSettingsView.as_view(), name="tenant-settings"),
    path("branches", BranchListView.as_view(), name="branch-list"),
]
