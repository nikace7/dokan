"""URL routes for accounts — authentication endpoints."""

from django.urls import path

from apps.accounts.auth_views import (
    LoginOtpConfirmView,
    LoginOtpRequestView,
    LoginOtpView,
    LogoutView,
    MeView,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    SessionListView,
    SessionRevokeOthersView,
    SessionRevokeView,
    TenantTokenRefreshView,
    TokenObtainView,
)
from apps.accounts.views import (
    PermissionListView,
    RoleDetailView,
    RoleListView,
    StaffListView,
    StaffRoleAssignmentView,
    StaffRoleRevokeView,
)

app_name = "accounts"

urlpatterns = [
    path("auth/token", TokenObtainView.as_view(), name="token"),
    path("auth/token/refresh", TenantTokenRefreshView.as_view(), name="token-refresh"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("auth/me", MeView.as_view(), name="me"),
    path("auth/sessions", SessionListView.as_view(), name="session-list"),
    path(
        "auth/sessions/revoke-others",
        SessionRevokeOthersView.as_view(),
        name="session-revoke-others",
    ),
    path(
        "auth/sessions/<uuid:pk>/revoke",
        SessionRevokeView.as_view(),
        name="session-revoke",
    ),
    path(
        "auth/password-reset/request",
        PasswordResetRequestView.as_view(),
        name="password-reset-request",
    ),
    path(
        "auth/password-reset/confirm",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("auth/password/change", PasswordChangeView.as_view(), name="password-change"),
    path("auth/login-otp/request", LoginOtpRequestView.as_view(), name="login-otp-request"),
    path("auth/login-otp/confirm", LoginOtpConfirmView.as_view(), name="login-otp-confirm"),
    path("auth/login-otp", LoginOtpView.as_view(), name="login-otp"),
    path("permissions", PermissionListView.as_view(), name="permission-list"),
    path("roles", RoleListView.as_view(), name="role-list"),
    path("roles/<uuid:pk>", RoleDetailView.as_view(), name="role-detail"),
    path("users", StaffListView.as_view(), name="staff-list"),
    path("users/<uuid:pk>/roles", StaffRoleAssignmentView.as_view(), name="staff-role-assignment"),
    path(
        "users/<uuid:pk>/roles/<uuid:assignment_id>",
        StaffRoleRevokeView.as_view(),
        name="staff-role-revoke",
    ),
]
