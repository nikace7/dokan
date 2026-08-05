"""DRF views for stock transfers and physical counts — thin views.

Permissions: ``stock.view`` for reads, ``stock.adjust`` (sensitive) for
every transition (send/receive/complete/finalize/cancel/create).
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import ItemVariant
from apps.inventory import counts as count_services
from apps.inventory import selectors
from apps.inventory import transfers as transfer_services
from apps.inventory.models import StockCount, StockTransfer
from apps.inventory.serializers import (
    CountCreateSerializer,
    CountRecordSerializer,
    StockCountSerializer,
    StockTransferSerializer,
    TransferCreateSerializer,
    TransferReceiveSerializer,
)
from apps.tenants.models import Branch
from core.middleware.tenant import require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "stock.view",
    "POST": "stock.adjust",
    "PATCH": "stock.adjust",
    "DELETE": "stock.adjust",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _get_or_404(tenant: Any, model: Any, pk: Any, what: str) -> Any:
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError(f"{what.upper()}_NOT_FOUND", f"{what} not found.", http_status=404)
    return instance


def _uuid_param(request: Request, name: str) -> UUID | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


class _OpsAPIView(APIView):
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

    def _lines(self, tenant: Any, raw_lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "variant": _get_or_404(tenant, ItemVariant, raw["variant"], "Variant"),
                "qty": raw["qty"],
            }
            for raw in raw_lines
        ]


class _TransferAPIView(_OpsAPIView):
    plan_features_by_method: ClassVar[dict[str, str]] = {
        "GET": "multi_branch",
        "POST": "multi_branch",
        "PATCH": "multi_branch",
        "DELETE": "multi_branch",
    }


class TransferListView(_TransferAPIView):
    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_transfers(
            tenant,
            _user(request),
            status=request.query_params.get("status", ""),
            branch_id=_uuid_param(request, "branch"),
        )
        return self._paginated(request, qs, StockTransferSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = TransferCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        from_branch = _get_or_404(tenant, Branch, data["from_branch"], "From branch")
        to_branch = _get_or_404(tenant, Branch, data["to_branch"], "To branch")
        transfer = transfer_services.create_transfer(
            tenant,
            from_branch=from_branch,
            to_branch=to_branch,
            lines=self._lines(tenant, data["lines"]),
            note=data.get("note", ""),
            created_by=_user(request),
        )
        return ok(
            StockTransferSerializer(transfer, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class TransferDetailView(_TransferAPIView):
    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        transfer = _get_or_404(tenant, StockTransfer, pk, "Transfer")
        return ok(StockTransferSerializer(transfer, context=self._context(request)).data)


class TransferSendView(_TransferAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        transfer = _get_or_404(tenant, StockTransfer, pk, "Transfer")
        transfer = transfer_services.send_transfer(
            tenant, transfer=transfer, created_by=_user(request)
        )
        return ok(StockTransferSerializer(transfer, context=self._context(request)).data)


class TransferReceiveView(_TransferAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        serializer = TransferReceiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transfer = _get_or_404(tenant, StockTransfer, pk, "Transfer")
        transfer = transfer_services.receive_transfer(
            tenant,
            transfer=transfer,
            receipts=self._lines(tenant, serializer.validated_data["lines"]),
            created_by=_user(request),
        )
        return ok(StockTransferSerializer(transfer, context=self._context(request)).data)


class TransferCompleteView(_TransferAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        transfer = _get_or_404(tenant, StockTransfer, pk, "Transfer")
        transfer = transfer_services.complete_transfer(
            tenant, transfer=transfer, created_by=_user(request)
        )
        return ok(StockTransferSerializer(transfer, context=self._context(request)).data)


class TransferCancelView(_TransferAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        transfer = _get_or_404(tenant, StockTransfer, pk, "Transfer")
        transfer = transfer_services.cancel_transfer(tenant, transfer=transfer)
        return ok({"id": str(pk), "status": transfer.status})


class InTransitView(_TransferAPIView):
    """GET /inventory/transfers/in-transit — stock between branches now."""

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(selectors.in_transit(tenant, branch_id=_uuid_param(request, "branch")))


class CountListView(_OpsAPIView):
    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_counts(
            tenant,
            _user(request),
            status=request.query_params.get("status", ""),
            branch_id=_uuid_param(request, "branch"),
        )
        return self._paginated(request, qs, StockCountSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = CountCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch = _get_or_404(tenant, Branch, serializer.validated_data["branch"], "Branch")
        count = count_services.start_count(tenant, branch=branch, created_by=_user(request))
        return ok(
            StockCountSerializer(count, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class CountDetailView(_OpsAPIView):
    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        count = _get_or_404(tenant, StockCount, pk, "Count")
        return ok(StockCountSerializer(count, context=self._context(request)).data)


class CountRecordView(_OpsAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        serializer = CountRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        count = _get_or_404(tenant, StockCount, pk, "Count")
        counts = [
            {
                "variant": _get_or_404(tenant, ItemVariant, raw["variant"], "Variant"),
                "counted_qty": raw["counted_qty"],
                "note": raw.get("note", ""),
            }
            for raw in serializer.validated_data["counts"]
        ]
        count = count_services.record_counts(tenant, count=count, counts=counts)
        return ok(StockCountSerializer(count, context=self._context(request)).data)


class CountFinalizeView(_OpsAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        count = _get_or_404(tenant, StockCount, pk, "Count")
        count = count_services.finalize_count(tenant, count=count, created_by=_user(request))
        return ok(StockCountSerializer(count, context=self._context(request)).data)


class CountCancelView(_OpsAPIView):
    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        count = _get_or_404(tenant, StockCount, pk, "Count")
        count = count_services.cancel_count(tenant, count=count)
        return ok({"id": str(pk), "status": count.status})
