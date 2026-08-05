"""Platform-admin routes; all are additionally protected by host/IP middleware."""

from django.urls import path

from apps.platformadmin.views import (
    PlatformMeView,
    PlatformTokenObtainView,
    PlatformTokenRefreshView,
)

urlpatterns = [
    path("admin/auth/token", PlatformTokenObtainView.as_view(), name="platform-token"),
    path(
        "admin/auth/token/refresh",
        PlatformTokenRefreshView.as_view(),
        name="platform-token-refresh",
    ),
    path("admin/auth/me", PlatformMeView.as_view(), name="platform-me"),
]
