"""URL routes for sales."""

from django.urls import path

from apps.sales.views import (
    CancelBillView,
    CompleteBillView,
    HeldBillListView,
    HoldBillView,
    SaleDetailView,
    SaleListView,
)

app_name = "sales"

urlpatterns = [
    path("sales", SaleListView.as_view(), name="sale-list"),
    path("sales/hold", HoldBillView.as_view(), name="sale-hold"),
    path("sales/held", HeldBillListView.as_view(), name="sale-held"),
    path("sales/<uuid:pk>", SaleDetailView.as_view(), name="sale-detail"),
    path("sales/<uuid:pk>/complete", CompleteBillView.as_view(), name="sale-complete"),
    path("sales/<uuid:pk>/cancel", CancelBillView.as_view(), name="sale-cancel"),
]
