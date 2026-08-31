"""DRF views for compliance — thin: parse, authorize, delegate.

- ``GET /compliance/status/<invoice_id>`` — per-bill sync status for the
  billing UI, gated on ``sale.view`` (counter staff see it on the bill).
- ``GET /compliance/failures`` — failed syncs for ops, gated on
  ``compliance.view`` (seeded in compliance.0001).
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.compliance import selectors
from apps.compliance.serializers import (
    CbmsSyncFailureSerializer,
    CbmsSyncStatusSerializer,
)
from apps.sales.models import SalesInvoice
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


class _ComplianceAPIView(APIView):
    permission_classes = (HasPermission,)

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _context(self, request: Request) -> dict[str, Any]:
        return {"request": request, "user": _user(request)}


class InvoiceSyncStatusView(_ComplianceAPIView):
    """GET /compliance/status/<invoice_id> — synced/pending/failed per bill."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "sale.view"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=CbmsSyncStatusSerializer),
    }

    def get(self, request: Request, invoice_id: UUID) -> Response:
        tenant = require_request_tenant(request)
        invoice = SalesInvoice.objects.filter(tenant=tenant, pk=invoice_id).first()
        if invoice is None:
            return error(404, "INVOICE_NOT_FOUND", "Invoice not found.")
        row = selectors.get_status_for_invoice(tenant, _user(request), invoice_id)
        if row is None:
            return ok({"invoice": str(invoice_id), "status": "NOT_QUEUED"})
        return ok(CbmsSyncStatusSerializer(row, context=self._context(request)).data)


class SyncFailureListView(_ComplianceAPIView):
    """GET /compliance/failures — the ops retry dashboard list."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "compliance.view"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=CbmsSyncFailureSerializer,
            response_many=True,
            paginated=True,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_failures(tenant, _user(request))
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = CbmsSyncFailureSerializer(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)
