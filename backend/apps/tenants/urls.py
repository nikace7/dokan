"""URL routes for tenant-scoped metadata and platform tenant operations."""

from django.urls import path

from apps.tenants.views import BranchListView

urlpatterns = [
    path("branches", BranchListView.as_view(), name="branch-list"),
]
