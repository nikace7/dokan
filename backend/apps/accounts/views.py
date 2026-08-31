"""Thin tenant role and staff-management views."""

from typing import Any, ClassVar, cast
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import selectors, services
from apps.accounts.models import Role, User, UserRole
from apps.accounts.serializers import (
    PermissionSerializer,
    RoleCreateSerializer,
    RoleSerializer,
    RoleUpdateSerializer,
    StaffCreateSerializer,
    StaffRoleAssignmentSerializer,
    StaffUserSerializer,
)
from apps.tenants.models import Branch
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok


def _user(request: Request) -> User:
    return cast("User", request.user)  # HasPermission authenticates the request


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

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=PermissionSerializer, response_many=True),
    }

    def get(self, request: Request) -> Response:
        data: list[Any] = list(
            PermissionSerializer(selectors.list_permissions(_user(request)), many=True).data
        )
        return ok(data)


class RoleListView(_AccountsManagementAPIView):
    """GET/POST /roles — list and create tenant roles."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=RoleSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=RoleCreateSerializer,
            response=RoleSerializer,
            status_code=201,
        ),
    }

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
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(request=RoleUpdateSerializer, response=RoleSerializer),
        "DELETE": operation(),
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

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=StaffUserSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=StaffCreateSerializer,
            response=StaffUserSerializer,
            status_code=201,
        ),
    }

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

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=StaffRoleAssignmentSerializer,
            status_code=(200, 201),
        ),
    }

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


class StaffRoleRevokeView(_AccountsManagementAPIView):
    """DELETE /users/<id>/roles/<assignment_id> — revoke one assignment."""

    method_permissions: ClassVar[dict[str, str]] = {
        "DELETE": "user.manage",
    }
    schema_contract: ClassVar[dict[str, Any]] = {"DELETE": operation()}

    def delete(self, request: Request, pk: UUID, assignment_id: UUID) -> Response:
        tenant = require_request_tenant(request)
        user = _tenant_object(tenant, User, pk, "Staff account")
        assignment = _tenant_object(tenant, UserRole, assignment_id, "Role assignment")
        services.unassign_staff_role(
            tenant, actor=_user(request), user=user, assignment=assignment, request=request
        )
        return ok({"revoked": str(assignment_id), "user": str(user.id)})


def _tenant_object(tenant: Any, model: Any, pk: UUID, what: str) -> Any:
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError("NOT_FOUND", f"{what} not found.", http_status=404)
    return instance
