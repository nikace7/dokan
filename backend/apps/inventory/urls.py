"""URL routes for inventory."""

from django.urls import path

from apps.inventory.views import (
    AdjustmentView,
    LevelListView,
    MovementListView,
    OpeningStockView,
    WriteOffView,
)

app_name = "inventory"

urlpatterns = [
    path("inventory/levels", LevelListView.as_view(), name="level-list"),
    path("inventory/movements", MovementListView.as_view(), name="movement-list"),
    path("inventory/opening", OpeningStockView.as_view(), name="opening"),
    path("inventory/adjustments", AdjustmentView.as_view(), name="adjustment"),
    path("inventory/write-offs", WriteOffView.as_view(), name="write-off"),
]
