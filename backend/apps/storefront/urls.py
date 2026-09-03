from django.urls import path

from apps.storefront.views import (
    StorefrontProductListView,
    StorefrontSiteView,
    StoreSettingsView,
)
from apps.storefront.views_management import (
    StoreOrderAdvanceView,
    StoreOrderCancelView,
    StoreOrderManagementListView,
    StoreOrderPrepareView,
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
    path(
        "storefront/manage/orders",
        StoreOrderManagementListView.as_view(),
        name="manage-orders",
    ),
    path(
        "storefront/manage/orders/<uuid:pk>/prepare",
        StoreOrderPrepareView.as_view(),
        name="manage-order-prepare",
    ),
    path(
        "storefront/manage/orders/<uuid:pk>/advance",
        StoreOrderAdvanceView.as_view(),
        name="manage-order-advance",
    ),
    path(
        "storefront/manage/orders/<uuid:pk>/cancel",
        StoreOrderCancelView.as_view(),
        name="manage-order-cancel",
    ),
]
