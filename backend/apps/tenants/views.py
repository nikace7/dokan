"""DRF views for tenant, plan, subscription, provisioning — thin: parse, authorize, delegate."""

from typing import Any, ClassVar

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenants import selectors
from apps.tenants.serializers import BranchSerializer
from core.middleware.tenant import require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


class BranchListView(APIView):
    """GET /branches — active tenant branch choices."""

    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = {"GET": "catalog.view"}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        raw_active = request.query_params.get("is_active")
        is_active = None if raw_active is None else raw_active.lower() in {"1", "true", "yes"}
        queryset = selectors.list_branches(tenant, _user(request), is_active=is_active)
        paginator = EnvelopePageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data: list[Any] = list(BranchSerializer(page, many=True, context={"request": request}).data)
        return paginator.get_paginated_response(data)
