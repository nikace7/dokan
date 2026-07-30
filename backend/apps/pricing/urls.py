"""URL routes for pricing."""

from django.urls import path

from apps.pricing.views import (
    BoundsView,
    PriceChangeListView,
    PriceListView,
    RateTypeDetailView,
    RateTypeListView,
    ResolvePriceView,
)

app_name = "pricing"

urlpatterns = [
    path("pricing/rate-types", RateTypeListView.as_view(), name="rate-type-list"),
    path("pricing/rate-types/<uuid:pk>", RateTypeDetailView.as_view(), name="rate-type-detail"),
    path("pricing/resolve", ResolvePriceView.as_view(), name="resolve"),
    path("pricing/prices", PriceListView.as_view(), name="price-list"),
    path("pricing/changes", PriceChangeListView.as_view(), name="change-list"),
    path("pricing/bounds/<str:target_kind>/<uuid:pk>", BoundsView.as_view(), name="bounds"),
]
