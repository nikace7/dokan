from django.urls import path

from apps.storefront.views import (
    StorefrontProductListView,
    StorefrontSiteView,
    StoreSettingsView,
)
from apps.storefront.views_order import (
    StorefrontProductDetailView,
    StoreMyOrdersView,
    StoreOrderCreateView,
    StoreOrderTrackingView,
    StoreOtpRequestView,
    StoreOtpVerifyView,
)

app_name = "storefront"

urlpatterns = [
    path("storefront/site", StorefrontSiteView.as_view(), name="site"),
    path("storefront/products", StorefrontProductListView.as_view(), name="products"),
    path(
        "storefront/products/<uuid:pk>",
        StorefrontProductDetailView.as_view(),
        name="product-detail",
    ),
    path("storefront/settings", StoreSettingsView.as_view(), name="settings"),
    path("storefront/auth/otp", StoreOtpRequestView.as_view(), name="otp-request"),
    path("storefront/auth/verify", StoreOtpVerifyView.as_view(), name="otp-verify"),
    path("storefront/orders", StoreOrderCreateView.as_view(), name="order-create"),
    path(
        "storefront/orders/<uuid:tracking_token>",
        StoreOrderTrackingView.as_view(),
        name="order-tracking",
    ),
    path("storefront/my/orders", StoreMyOrdersView.as_view(), name="my-orders"),
]
