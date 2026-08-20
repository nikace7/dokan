"""URL routes for catalog."""

from django.urls import path

from apps.catalog.views import (
    BrandDetailView,
    BrandListView,
    CategoryDetailView,
    CategoryListView,
    ItemDetailView,
    ItemImageView,
    ItemListView,
    SizeChartDetailView,
    SizeChartListView,
)
from apps.catalog.views_variants import (
    QuickCreateProductView,
    VariantBulkView,
    VariantDetailView,
    VariantForSaleView,
    VariantListView,
    VariantLookupView,
)

app_name = "catalog"

urlpatterns = [
    path("catalog/categories", CategoryListView.as_view(), name="category-list"),
    path("catalog/categories/<uuid:pk>", CategoryDetailView.as_view(), name="category-detail"),
    path("catalog/brands", BrandListView.as_view(), name="brand-list"),
    path("catalog/brands/<uuid:pk>", BrandDetailView.as_view(), name="brand-detail"),
    path("catalog/size-charts", SizeChartListView.as_view(), name="size-chart-list"),
    path("catalog/size-charts/<uuid:pk>", SizeChartDetailView.as_view(), name="size-chart-detail"),
    path("catalog/items", ItemListView.as_view(), name="item-list"),
    path("catalog/items/<uuid:pk>", ItemDetailView.as_view(), name="item-detail"),
    path("catalog/items/<uuid:pk>/image", ItemImageView.as_view(), name="item-image"),
    path("catalog/items/<uuid:pk>/variants/bulk", VariantBulkView.as_view(), name="variant-bulk"),
    path(
        "catalog/products/quick-create",
        QuickCreateProductView.as_view(),
        name="product-quick-create",
    ),
    path("catalog/variants", VariantListView.as_view(), name="variant-list"),
    path("catalog/variants/lookup", VariantLookupView.as_view(), name="variant-lookup"),
    path("catalog/variants/for-sale", VariantForSaleView.as_view(), name="variant-for-sale"),
    path("catalog/variants/<uuid:pk>", VariantDetailView.as_view(), name="variant-detail"),
]
