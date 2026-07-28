"""DRF views for accounts — thin: parse, authorize, delegate.

Endpoints (docs/SYSTEM_DESIGN.md §8.4):
- ``POST /api/v1/auth/token``         phone+password login (tenant-scoped)
- ``POST /api/v1/auth/token/refresh`` rotating refresh
- ``GET  /api/v1/auth/me``            current user + permissions
"""

from typing import Any, cast

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts.models import User
from apps.accounts.selectors import get_permission_codes
from apps.accounts.serializers import MeSerializer, TokenObtainSerializer
from apps.accounts.services import AuthError, authenticate_tenant_user
from apps.accounts.tokens import issue_tokens_for_user
from core.middleware.tenant import get_request_tenant


def _ok(data: Any, http_status: int = status.HTTP_200_OK) -> Response:
    """Success envelope (docs/SYSTEM_DESIGN.md §8.4)."""
    return Response({"data": data, "error": None}, status=http_status)


def _error(http_status: int, code: str, message: str) -> Response:
    """Error envelope with a machine-readable code."""
    return Response({"data": None, "error": {"code": code, "message": message}}, status=http_status)


class TokenObtainView(APIView):
    """Phone+password login, scoped to the request's tenant (from subdomain)."""

    permission_classes = (AllowAny,)
    authentication_classes: tuple = ()

    def post(self, request: Request) -> Response:
        tenant = get_request_tenant(request)
        if tenant is None:
            return _error(
                status.HTTP_400_BAD_REQUEST,
                "TENANT_REQUIRED",
                "Log in from your shop's subdomain.",
            )

        serializer = TokenObtainSerializer(data=request.data)
        if not serializer.is_valid():
            return _error(status.HTTP_400_BAD_REQUEST, "VALIDATION_ERROR", str(serializer.errors))

        try:
            user = authenticate_tenant_user(tenant=tenant, **serializer.validated_data)
        except AuthError as exc:
            http_status = (
                status.HTTP_423_LOCKED
                if exc.code == "ACCOUNT_LOCKED"
                else status.HTTP_401_UNAUTHORIZED
            )
            return _error(http_status, exc.code, exc.message)

        return _ok(issue_tokens_for_user(user))


class TenantTokenRefreshView(TokenRefreshView):
    """Rotating refresh; the response is wrapped in the API envelope."""

    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            response.data = {"data": response.data, "error": None}
        return response


class MeView(APIView):
    """Current user plus their resolved permission codenames."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        user = cast("User", request.user)  # IsAuthenticated guarantees a User
        return _ok(MeSerializer.for_user(user, get_permission_codes(user)))
