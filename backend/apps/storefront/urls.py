from django.urls import path

from apps.storefront.views import StorefrontProductListView, StorefrontSiteView

app_name = "storefront"

urlpatterns = [
    path("storefront/site", StorefrontSiteView.as_view(), name="site"),
    path("storefront/products", StorefrontProductListView.as_view(), name="products"),
]
