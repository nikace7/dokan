"""DRF views for accounts — thin: parse, authorize, delegate.

Endpoints (docs/SYSTEM_DESIGN.md §8.4):
- ``POST /api/v1/auth/token``         phone+password login (tenant-scoped)
- ``POST /api/v1/auth/token/refresh`` rotating refresh
- ``GET  /api/v1/auth/me``            current user + permissions
"""

from typing import Any, ClassVar, cast
from uuid import UUID

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts import selectors, services
from apps.accounts.models import Role, User
from apps.accounts.selectors import get_permission_codes
from apps.accounts.serializers import (
    MeSerializer,
    PermissionSerializer,
    RoleCreateSerializer,
    RoleSerializer,
    RoleUpdateSerializer,
    StaffCreateSerializer,
    StaffRoleAssignmentSerializer,
    StaffUserSerializer,
    TokenObtainSerializer,
)
from apps.accounts.services import AuthError, authenticate_tenant_user
from apps.accounts.tokens import issue_tokens_for_user
from apps.tenants.models import Branch
from apps.tenants.selectors import get_effective_plan_features
from core.middleware.tenant import get_request_tenant, require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok


def _ok(data: Any, http_status: int = status.HTTP_200_OK) -> Response:
    """Success envelope (docs/SYSTEM_DESIGN.md §8.4)."""
    return Response({"data": data, "error": None}, status=http_status)


def _error(http_status: int, code: str, message: str) -> Response:
    """Error envelope with a machine-readable code."""
    return Response({"data": None, "error": {"code": code, "message": message}}, status=http_status)


def _user(request: Request) -> User:
    return cast("User", request.user)  # HasPermission authenticates the request


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
        tenant = require_request_tenant(request)
        plan = {
            "code": tenant.plan.code,
            "name": tenant.plan.name,
            "features": get_effective_plan_features(tenant),
        }
        return _ok(MeSerializer.for_user(user, get_permission_codes(user), plan))


class _AccountsManagementAPIView(APIView):
    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = {
        "GET": "user.manage",
        "POST": "user.manage",
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)


class PermissionListView(_AccountsManagementAPIView):
    """GET /permissions — global permission catalog for role editing."""

    def get(self, request: Request) -> Response:
        data: list[Any] = list(
            PermissionSerializer(selectors.list_permissions(_user(request)), many=True).data
        )
        return ok(data)


class RoleListView(_AccountsManagementAPIView):
    """GET/POST /roles — list and create tenant roles."""

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        paginator = EnvelopePageNumberPagination()
        page = paginator.paginate_queryset(
            selectors.list_roles(tenant, _user(request)), request, view=self
        )
        data: list[Any] = list(RoleSerializer(page, many=True).data)
        return paginator.get_paginated_response(data)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = RoleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        role = services.create_role(
            tenant,
            actor=_user(request),
            code=data["code"],
            name=data["name"],
            name_np=data.get("name_np"),
            description=data.get("description"),
            permission_codes=data.get("permission_codes", []),
            request=request,
        )
        return ok(RoleSerializer(role).data, status.HTTP_201_CREATED)


class RoleDetailView(_AccountsManagementAPIView):
    """PATCH/DELETE /roles/<id> — change or remove custom roles."""

    method_permissions: ClassVar[dict[str, str]] = {
        "PATCH": "user.manage",
        "DELETE": "user.manage",
    }

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        serializer = RoleUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        role = _tenant_object(tenant, Role, pk, "Role")
        updated = services.update_role(
            tenant,
            actor=_user(request),
            role=role,
            changes=serializer.validated_data,
            request=request,
        )
        return ok(RoleSerializer(updated).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        role = _tenant_object(tenant, Role, pk, "Role")
        services.delete_role(tenant, actor=_user(request), role=role, request=request)
        return ok({"deleted": str(pk)})


class StaffListView(_AccountsManagementAPIView):
    """GET/POST /users — tenant staff administration."""

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        paginator = EnvelopePageNumberPagination()
        page = paginator.paginate_queryset(
            selectors.list_staff(tenant, _user(request)), request, view=self
        )
        data: list[Any] = list(StaffUserSerializer(page, many=True).data)
        return paginator.get_paginated_response(data)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = StaffCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        role = _tenant_object(tenant, Role, data["role"], "Role")
        branch = (
            _tenant_object(tenant, Branch, data["branch"], "Branch") if data.get("branch") else None
        )
        user = services.create_staff_user(
            tenant,
            actor=_user(request),
            phone=data["phone"],
            full_name=data["full_name"],
            email=data.get("email"),
            password=data["password"],
            role=role,
            branch=branch,
            request=request,
        )
        return ok(StaffUserSerializer(user).data, status.HTTP_201_CREATED)


class StaffRoleAssignmentView(_AccountsManagementAPIView):
    """POST /users/<id>/roles — assign one existing role to staff."""

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        serializer = StaffRoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = _tenant_object(tenant, User, pk, "Staff account")
        role = _tenant_object(tenant, Role, data["role"], "Role")
        branch = (
            _tenant_object(tenant, Branch, data["branch"], "Branch") if data.get("branch") else None
        )
        assignment, created = services.assign_staff_role(
            tenant,
            actor=_user(request),
            user=user,
            role=role,
            branch=branch,
            request=request,
        )
        return ok(
            {
                "id": str(assignment.id),
                "created": created,
                "user": str(user.id),
                "role": role.code,
                "branch": branch.code if branch else None,
            },
            status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


def _tenant_object(tenant: Any, model: Any, pk: UUID, what: str) -> Any:
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError("NOT_FOUND", f"{what} not found.", http_status=404)
    return instance
