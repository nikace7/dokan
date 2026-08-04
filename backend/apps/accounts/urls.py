"""URL routes for accounts — authentication endpoints."""

from django.urls import path

from apps.accounts.views import (
    MeView,
    RoleListView,
    StaffListView,
    StaffRoleAssignmentView,
    TenantTokenRefreshView,
    TokenObtainView,
)

app_name = "accounts"

urlpatterns = [
    path("auth/token", TokenObtainView.as_view(), name="token"),
    path("auth/token/refresh", TenantTokenRefreshView.as_view(), name="token-refresh"),
    path("auth/me", MeView.as_view(), name="me"),
    path("roles", RoleListView.as_view(), name="role-list"),
    path("users", StaffListView.as_view(), name="staff-list"),
    path("users/<uuid:pk>/roles", StaffRoleAssignmentView.as_view(), name="staff-role-assignment"),
]
