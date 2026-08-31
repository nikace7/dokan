"""DRF views for tenant, plan, subscription, provisioning — thin: parse, authorize, delegate."""

from typing import Any, ClassVar

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenants import selectors, services
from apps.tenants.serializers import BranchSerializer, TenantSettingsSerializer
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


class TenantSettingsView(APIView):
    """GET/PATCH /settings — owner-level shop profile settings."""

    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = {
        "GET": "settings.manage",
        "PATCH": "settings.manage",
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=TenantSettingsSerializer),
        "PATCH": operation(
            request=TenantSettingsSerializer,
            response=TenantSettingsSerializer,
        ),
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        settings = selectors.get_tenant_settings(tenant, _user(request))
        return ok(TenantSettingsSerializer(settings).data)

    def patch(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = TenantSettingsSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        settings = services.update_tenant_settings(
            tenant,
            actor=_user(request),
            request=request,
            **serializer.validated_data,
        )
        return ok(TenantSettingsSerializer(settings).data)


class BranchListView(APIView):
    """GET /branches — active tenant branch choices."""

    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = {"GET": "catalog.view"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=BranchSerializer, response_many=True, paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        raw_active = request.query_params.get("is_active")
        is_active = None if raw_active is None else raw_active.lower() in {"1", "true", "yes"}
        queryset = selectors.list_branches(tenant, _user(request), is_active=is_active)
        paginator = EnvelopePageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data: list[Any] = list(BranchSerializer(page, many=True, context={"request": request}).data)
        return paginator.get_paginated_response(data)
