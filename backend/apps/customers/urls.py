"""URL routes for customers."""

from django.urls import path

from apps.customers.views import (
    CustomerDetailView,
    CustomerListView,
    CustomerOutstandingView,
)
from apps.payments.views import CustomerLedgerView

app_name = "customers"

urlpatterns = [
    path("customers", CustomerListView.as_view(), name="customer-list"),
    path("customers/<uuid:pk>", CustomerDetailView.as_view(), name="customer-detail"),
    path(
        "customers/<uuid:pk>/outstanding",
        CustomerOutstandingView.as_view(),
        name="customer-outstanding",
    ),
    path("customers/<uuid:pk>/ledger", CustomerLedgerView.as_view(), name="customer-ledger"),
]
