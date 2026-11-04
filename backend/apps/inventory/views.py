"""DRF views for inventory — thin: parse, authorize, delegate.

Permissions: ``stock.view`` for reads, ``stock.adjust`` for writes
(per-method via core.permissions.HasPermission). All responses use the API
envelope; lists paginate via EnvelopePageNumberPagination.
"""

from datetime import date
from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import ItemVariant
from apps.inventory import selectors, services
from apps.inventory.serializers import (
    AdjustmentSerializer,
    OpeningStockSerializer,
    StockLevelSerializer,
    StockMovementSerializer,
    StockSummarySerializer,
    WriteOffSerializer,
)
from apps.tenants.models import Branch
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, get_or_404, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "stock.view",
    "POST": "stock.adjust",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _uuid_param(request: Request, name: str) -> UUID | None:
    """Parse a UUID query param; unparseable values mean 'no filter'."""
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _parse_date(raw: str, param: str) -> date | None:
    """Parse an AD ISO date query param (design §6.4: API exchanges AD only)."""
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ServiceError(
            "DATE_INVALID", f"Query parameter '{param}' must be an ISO date (YYYY-MM-DD)."
        ) from exc


class _InventoryAPIView(APIView):
    """Shared plumbing: envelope error conversion + serializer context."""

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
        serializer = serializer_class(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)

    def _resolve_refs(self, tenant: Any, validated: dict[str, Any]) -> tuple[Any, Any]:
        """Tenant-scoped branch/variant lookup for the write payloads."""
        branch = get_or_404(tenant, Branch, validated["branch"], "Branch")
        variant = get_or_404(tenant, ItemVariant, validated["variant"], "Variant")
        return branch, variant


class LevelListView(_InventoryAPIView):
    """GET /inventory/levels — current stock projection."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=StockLevelSerializer, response_many=True, paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_levels(
            tenant,
            _user(request),
            branch_id=_uuid_param(request, "branch"),
            variant_id=_uuid_param(request, "variant"),
            item_id=_uuid_param(request, "item"),
            search=request.query_params.get("search", ""),
        )
        return self._paginated(request, qs, StockLevelSerializer)


class StockSummaryView(_InventoryAPIView):
    """GET /inventory/summary — current totals across all tenant branches."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=StockSummarySerializer),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        totals = selectors.stock_totals(tenant, _user(request))
        serializer = StockSummarySerializer(totals, context=self._context(request))
        return ok(serializer.data)


class MovementListView(_InventoryAPIView):
    """GET /inventory/movements — the immutable ledger."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=StockMovementSerializer, response_many=True, paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_movements(
            tenant,
            _user(request),
            branch_id=_uuid_param(request, "branch"),
            variant_id=_uuid_param(request, "variant"),
            movement_type=request.query_params.get("type", ""),
            date_from=_parse_date(request.query_params.get("date_from", ""), "date_from"),
            date_to=_parse_date(request.query_params.get("date_to", ""), "date_to"),
        )
        return self._paginated(request, qs, StockMovementSerializer)


class OpeningStockView(_InventoryAPIView):
    """POST /inventory/opening — initial stock with weighted-average cost."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=OpeningStockSerializer,
            response=StockMovementSerializer,
            status_code=201,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = OpeningStockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch, variant = self._resolve_refs(tenant, serializer.validated_data)
        movement = services.post_opening_stock(
            tenant,
            branch=branch,
            variant=variant,
            qty=serializer.validated_data["qty"],
            unit_cost=serializer.validated_data["unit_cost"],
            note=serializer.validated_data.get("note", ""),
            created_by=_user(request),
        )
        return ok(
            StockMovementSerializer(movement, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class AdjustmentView(_InventoryAPIView):
    """POST /inventory/adjustments — signed correction with a required reason."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=AdjustmentSerializer,
            response=StockMovementSerializer,
            status_code=201,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = AdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch, variant = self._resolve_refs(tenant, serializer.validated_data)
        movement = services.adjust_stock(
            tenant,
            branch=branch,
            variant=variant,
            qty_delta=serializer.validated_data["qty_delta"],
            reason=serializer.validated_data["reason"],
            created_by=_user(request),
        )
        return ok(
            StockMovementSerializer(movement, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class WriteOffView(_InventoryAPIView):
    """POST /inventory/write-offs — damage write-off with a required reason."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=WriteOffSerializer,
            response=StockMovementSerializer,
            status_code=201,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = WriteOffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch, variant = self._resolve_refs(tenant, serializer.validated_data)
        movement = services.write_off_damage(
            tenant,
            branch=branch,
            variant=variant,
            qty=serializer.validated_data["qty"],
            reason=serializer.validated_data["reason"],
            created_by=_user(request),
        )
        return ok(
            StockMovementSerializer(movement, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )
