"""URL routes for sales."""

from django.urls import path

from apps.sales.views import (
    CancelBillView,
    CompleteBillView,
    ExchangeCreateView,
    HeldBillListView,
    HoldBillView,
    ReturnableLinesView,
    ReturnCreateView,
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
    path("sales/returns", ReturnCreateView.as_view(), name="sale-return"),
    path("sales/exchanges", ExchangeCreateView.as_view(), name="sale-exchange"),
    path("sales/<uuid:pk>/returnable", ReturnableLinesView.as_view(), name="sale-returnable"),
]
