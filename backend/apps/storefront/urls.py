from django.urls import path

from apps.storefront.views import (
    StorefrontProductListView,
    StorefrontSiteView,
    StoreSettingsView,
)

app_name = "storefront"

urlpatterns = [
    path("storefront/site", StorefrontSiteView.as_view(), name="site"),
    path("storefront/products", StorefrontProductListView.as_view(), name="products"),
    path("storefront/settings", StoreSettingsView.as_view(), name="settings"),
]
