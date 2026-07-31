"""URL routes for purchasing."""

from django.urls import path

from apps.payments.views import SupplierLedgerView
from apps.purchasing.views import (
    InvoiceCancelView,
    InvoiceConfirmView,
    InvoiceDetailView,
    InvoiceListView,
    SupplierDetailView,
    SupplierListView,
)

app_name = "purchasing"

urlpatterns = [
    path("purchasing/suppliers", SupplierListView.as_view(), name="supplier-list"),
    path("purchasing/suppliers/<uuid:pk>", SupplierDetailView.as_view(), name="supplier-detail"),
    path("purchasing/invoices", InvoiceListView.as_view(), name="invoice-list"),
    path("purchasing/invoices/<uuid:pk>", InvoiceDetailView.as_view(), name="invoice-detail"),
    path(
        "purchasing/invoices/<uuid:pk>/confirm",
        InvoiceConfirmView.as_view(),
        name="invoice-confirm",
    ),
    path(
        "purchasing/invoices/<uuid:pk>/cancel",
        InvoiceCancelView.as_view(),
        name="invoice-cancel",
    ),
    path(
        "purchasing/suppliers/<uuid:pk>/ledger",
        SupplierLedgerView.as_view(),
        name="supplier-ledger",
    ),
]
