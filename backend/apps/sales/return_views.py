"""Thin HTTP adapters for returns, exchanges, and returnable quantities."""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from apps.catalog.models import ItemVariant
from apps.sales import selectors, services
from apps.sales.models import SalesInvoice
from apps.sales.serializers import (
    ExchangeCreateSerializer,
    ReturnCreateSerializer,
    SalesInvoiceDetailSerializer,
)
from apps.sales.views import _get_or_404, _idempotency_key, _SalesAPIView, _user
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.responses import error, ok


class ReturnCreateView(_SalesAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"POST": "sale.return"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=ReturnCreateSerializer,
            response=SalesInvoiceDetailSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        key = _idempotency_key(request)
        serializer = ReturnCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        original = _get_or_404(tenant, SalesInvoice, data["original_invoice"], "Invoice")
        lines = [
            services.ReturnLineInput(
                variant=_get_or_404(tenant, ItemVariant, raw["variant"], "Variant"),
                qty=raw["qty"],
            )
            for raw in data["lines"]
        ]
        result = services.create_return(
            tenant,
            original_invoice=original,
            lines=lines,
            reason=data["reason"],
            refunds=data.get("refunds", []),
            idempotency_key=key,
            created_by=_user(request),
        )
        http_status = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        response = ok(self._detail(request, result.invoice), http_status)
        if result.replayed:
            response["X-Idempotent-Replay"] = "true"
        return response


class ExchangeCreateView(_SalesAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"POST": "sale.return"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=ExchangeCreateSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        key = _idempotency_key(request)
        serializer = ExchangeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        original = _get_or_404(tenant, SalesInvoice, data["original_invoice"], "Invoice")
        returned_lines = [
            services.ReturnLineInput(
                variant=_get_or_404(tenant, ItemVariant, raw["variant"], "Variant"),
                qty=raw["qty"],
            )
            for raw in data["returned_lines"]
        ]
        result = services.create_exchange(
            tenant,
            original_invoice=original,
            returned_lines=returned_lines,
            new_lines=self._build_lines(tenant, data["new_lines"]),
            payments=data.get("payments", []),
            reason=data["reason"],
            idempotency_key=key,
            created_by=_user(request),
            override_reason=data.get("override_reason", ""),
            require_open_cash_session=True,
        )
        http_status = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        return ok(
            {
                "return_invoice": self._detail(request, result.return_invoice),
                "sale_invoice": self._detail(request, result.sale_invoice),
                "exchange_group_id": str(result.sale_invoice.exchange_group_id),
                "refund_amount": str(result.refund_amount),
            },
            http_status,
        )


class ReturnableLinesView(_SalesAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "sale.view"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        lines = selectors.get_returnable_lines(tenant, _user(request), pk)
        if lines is None:
            return error(404, "INVOICE_NOT_FOUND", "Invoice not found.")
        return ok(lines)
