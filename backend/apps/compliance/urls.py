"""URL routes for compliance."""

from django.urls import path

from apps.compliance.views import InvoiceSyncStatusView, SyncFailureListView

app_name = "compliance"

urlpatterns = [
    path(
        "compliance/status/<uuid:invoice_id>",
        InvoiceSyncStatusView.as_view(),
        name="sync-status",
    ),
    path("compliance/failures", SyncFailureListView.as_view(), name="sync-failures"),
]
