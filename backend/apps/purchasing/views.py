"""DRF views for purchasing — thin: parse, authorize, delegate.

Permissions: ``stock.view`` for reads, ``stock.purchase`` for writes.
Documented choice: purchasing staff legitimately see purchase costs — the
cost-hiding rule (invariant 10) targets SALES-side users, so these
endpoints expose unit_cost/avg_cost fields; ``stock.purchase`` implies
purchase-cost visibility.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.purchasing import selectors, services
from apps.purchasing.models import Supplier
from apps.purchasing.serializers import SupplierSerializer
from core.middleware.tenant import require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "stock.view",
    "POST": "stock.purchase",
    "PATCH": "stock.purchase",
    "DELETE": "stock.purchase",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _get_or_404(tenant: Any, model: Any, pk: Any, what: str) -> Any:
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError(f"{what.upper()}_NOT_FOUND", f"{what} not found.", http_status=404)
    return instance


class _PurchasingAPIView(APIView):
    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = _METHOD_PERMISSIONS

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _context(self, request: Request) -> dict[str, Any]:
        return {"request": request, "user": _user(request)}

    def _paginated(self, request: Request, queryset: Any, serializer_class: Any) -> Response:
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(queryset, request, view=self)
        serializer: Any = serializer_class(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)


class SupplierListView(_PurchasingAPIView):
    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        raw = request.query_params.get("is_active")
        is_active = None if raw is None else raw.lower() in {"1", "true", "yes"}
        qs = selectors.list_suppliers(
            tenant,
            _user(request),
            is_active=is_active,
            search=request.query_params.get("search", ""),
        )
        return self._paginated(request, qs, SupplierSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = SupplierSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        supplier = services.create_supplier(tenant, **serializer.validated_data)
        return ok(
            SupplierSerializer(supplier, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class SupplierDetailView(_PurchasingAPIView):
    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        supplier = _get_or_404(tenant, Supplier, pk, "Supplier")
        return ok(SupplierSerializer(supplier, context=self._context(request)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        supplier = _get_or_404(tenant, Supplier, pk, "Supplier")
        serializer = SupplierSerializer(
            supplier, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        supplier = services.update_supplier(supplier, **serializer.validated_data)
        return ok(SupplierSerializer(supplier, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        supplier = _get_or_404(tenant, Supplier, pk, "Supplier")
        services.deactivate_supplier(supplier)
        return ok({"id": str(pk), "is_active": False})
