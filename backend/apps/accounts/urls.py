"""URL routes for accounts — authentication endpoints."""

from django.urls import path

from apps.accounts.views import MeView, TenantTokenRefreshView, TokenObtainView

app_name = "accounts"

urlpatterns = [
    path("auth/token", TokenObtainView.as_view(), name="token"),
    path("auth/token/refresh", TenantTokenRefreshView.as_view(), name="token-refresh"),
    path("auth/me", MeView.as_view(), name="me"),
]
