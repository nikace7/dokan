"""Thin platform and tenant views for support-access sessions."""

from typing import Any, ClassVar, cast
from uuid import UUID

from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User, UserRole
from apps.platformadmin import impersonation, selectors
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.serializers import (
    ImpersonationSessionSerializer,
    ImpersonationStartSerializer,
    ImpersonationTargetSerializer,
)
from apps.platformadmin.views import _PlatformAPIView
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.responses import ServiceError, error, ok


def _platform_actor(request: Request) -> PlatformUser:
    return cast("PlatformUser", request.user)


def _tenant_user(request: Request) -> User:
    return cast("User", request.user)


def _is_owner(request: Request) -> bool:
    tenant = require_request_tenant(request)
    return UserRole.objects.filter(
        tenant=tenant,
        user=_tenant_user(request),
        role__code="OWNER",
    ).exists()


def _claim(request: Request, name: str) -> Any:
    getter = getattr(request.auth, "get", None)
    return getter(name) if callable(getter) else None


class TenantOwnerPermission(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(request.user.is_authenticated and _is_owner(request))


class ImpersonationStartView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "POST": (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.SUPPORT),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=ImpersonationStartSerializer, status_code=201),
    }

    def post(self, request: Request, tenant_pk: UUID) -> Response:
        serializer = ImpersonationStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session, access = impersonation.start_impersonation(
            selectors.get_tenant(_platform_actor(request), tenant_pk),
            actor=_platform_actor(request),
            target_user_id=serializer.validated_data["target_user"],
            reason=serializer.validated_data["reason"],
            scope=serializer.validated_data["scope"],
            duration_minutes=serializer.validated_data["duration_minutes"],
            request=request,
        )
        return ok(
            {
                "session": ImpersonationSessionSerializer(session).data,
                "access": access,
                "token_type": "Bearer",
            },
            status.HTTP_201_CREATED,
        )


class ImpersonationTargetListView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.SUPPORT),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ImpersonationTargetSerializer, response_many=True),
    }

    def get(self, request: Request, tenant_pk: UUID) -> Response:
        tenant = selectors.get_tenant(_platform_actor(request), tenant_pk)
        targets = selectors.list_impersonation_targets(tenant, _platform_actor(request))
        return ok(ImpersonationTargetSerializer(targets, many=True).data)


class AdminImpersonationEndView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "POST": (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.SUPPORT),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(response=ImpersonationSessionSerializer),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        actor = _platform_actor(request)
        session = selectors.get_impersonation(actor, pk)
        impersonation.assert_admin_can_end(actor, session)
        ended = impersonation.end_impersonation(
            session,
            ended_by=actor.pk,
            audit_actor=actor,
            request=request,
        )
        return ok(ImpersonationSessionSerializer(ended).data)


class _TenantSupportAPIView(APIView):
    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)


class TenantSupportAccessListView(_TenantSupportAPIView):
    permission_classes = (IsAuthenticated, TenantOwnerPermission)
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ImpersonationSessionSerializer, response_many=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.list_tenant_impersonations(tenant)
        return ok(ImpersonationSessionSerializer(rows, many=True).data)


class CurrentSupportAccessView(_TenantSupportAPIView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ImpersonationSessionSerializer),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        session_id = _claim(request, "jti")
        platform_user_id = _claim(request, "act")
        if not session_id or not platform_user_id:
            raise ServiceError(
                "SUPPORT_SESSION_REQUIRED",
                "No support session is active.",
                http_status=404,
            )
        session = selectors.get_tenant_impersonation(tenant, UUID(str(session_id)))
        if (
            str(session.platform_user_id) != str(platform_user_id)
            or session.target_user_id != _tenant_user(request).pk
        ):
            raise ServiceError(
                "SUPPORT_SESSION_REQUIRED",
                "No support session is active.",
                http_status=404,
            )
        return ok(ImpersonationSessionSerializer(session).data)


class TenantSupportAccessEndView(_TenantSupportAPIView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(response=ImpersonationSessionSerializer),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        session = selectors.get_tenant_impersonation(tenant, pk)
        acting_platform_user = _claim(request, "act")
        if acting_platform_user:
            if (
                str(session.platform_user_id) != str(acting_platform_user)
                or session.target_user_id != _tenant_user(request).pk
            ):
                raise ServiceError(
                    "IMPERSONATION_END_FORBIDDEN",
                    "This support session cannot be ended by the current actor.",
                    http_status=403,
                )
            ended_by = session.platform_user_id
        else:
            if not _is_owner(request):
                raise ServiceError(
                    "IMPERSONATION_END_FORBIDDEN",
                    "Only a shop owner can end this support session.",
                    http_status=403,
                )
            ended_by = _tenant_user(request).pk
        ended = impersonation.end_impersonation(
            session,
            ended_by=ended_by,
            audit_actor=session.platform_user,
            request=request,
        )
        return ok(ImpersonationSessionSerializer(ended).data)
