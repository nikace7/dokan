"""URL routes for inventory."""

from django.urls import path

from apps.inventory.ops_views import (
    CountCancelView,
    CountDetailView,
    CountFinalizeView,
    CountListView,
    CountRecordView,
    InTransitView,
    TransferCancelView,
    TransferCompleteView,
    TransferDetailView,
    TransferListView,
    TransferReceiveView,
    TransferSendView,
)
from apps.inventory.views import (
    AdjustmentView,
    LevelListView,
    MovementListView,
    OpeningStockView,
    StockSummaryView,
    WriteOffView,
)

app_name = "inventory"

urlpatterns = [
    path("inventory/summary", StockSummaryView.as_view(), name="stock-summary"),
    path("inventory/levels", LevelListView.as_view(), name="level-list"),
    path("inventory/movements", MovementListView.as_view(), name="movement-list"),
    path("inventory/opening", OpeningStockView.as_view(), name="opening"),
    path("inventory/adjustments", AdjustmentView.as_view(), name="adjustment"),
    path("inventory/write-offs", WriteOffView.as_view(), name="write-off"),
    path("inventory/transfers", TransferListView.as_view(), name="transfer-list"),
    path("inventory/transfers/in-transit", InTransitView.as_view(), name="in-transit"),
    path("inventory/transfers/<uuid:pk>", TransferDetailView.as_view(), name="transfer-detail"),
    path("inventory/transfers/<uuid:pk>/send", TransferSendView.as_view(), name="transfer-send"),
    path(
        "inventory/transfers/<uuid:pk>/receive",
        TransferReceiveView.as_view(),
        name="transfer-receive",
    ),
    path(
        "inventory/transfers/<uuid:pk>/complete",
        TransferCompleteView.as_view(),
        name="transfer-complete",
    ),
    path(
        "inventory/transfers/<uuid:pk>/cancel",
        TransferCancelView.as_view(),
        name="transfer-cancel",
    ),
    path("inventory/counts", CountListView.as_view(), name="count-list"),
    path("inventory/counts/<uuid:pk>", CountDetailView.as_view(), name="count-detail"),
    path("inventory/counts/<uuid:pk>/record", CountRecordView.as_view(), name="count-record"),
    path(
        "inventory/counts/<uuid:pk>/finalize",
        CountFinalizeView.as_view(),
        name="count-finalize",
    ),
    path("inventory/counts/<uuid:pk>/cancel", CountCancelView.as_view(), name="count-cancel"),
]
