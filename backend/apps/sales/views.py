"""DRF views for sales — thin: parse, authorize, delegate.

Permissions: ``sale.view`` reads, ``sale.create`` writes, ``sale.void``
cancel. ``POST /sales`` and ``POST /sales/hold`` require the
``Idempotency-Key`` header (invariant 8); a replay returns the original
invoice with HTTP 200.
"""

from datetime import date
from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import ItemVariant
from apps.customers.models import Customer
from apps.pricing.models import RateType
from apps.sales import selectors, services
from apps.sales.models import SalesInvoice
from apps.sales.serializers import (
    CompleteBillSerializer,
    HoldBillSerializer,
    SaleCreateSerializer,
    SalesInvoiceDetailSerializer,
    SalesInvoiceSerializer,
    SharedBillSerializer,
)
from apps.sales.throttles import SharedBillThrottle
from apps.tenants.models import Branch
from core.middleware.tenant import get_request_tenant, require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, get_or_404, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "sale.view",
    "POST": "sale.create",
    "DELETE": "sale.void",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _uuid_param(request: Request, name: str) -> UUID | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _date_param(request: Request, name: str) -> date | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ServiceError(
            "DATE_INVALID", f"Query parameter '{name}' must be an ISO date (YYYY-MM-DD)."
        ) from exc


def _invoice_no_param(request: Request) -> int | None:
    raw = request.query_params.get("invoice_no")
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise ServiceError(
            "INVOICE_NO_INVALID", "Query parameter 'invoice_no' must be a whole number."
        ) from exc


def _idempotency_key(request: Request) -> str:
    """The mandatory key (#8); missing → 400 IDEMPOTENCY_KEY_REQUIRED."""
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    return key


class _SalesAPIView(APIView):
    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = _METHOD_PERMISSIONS

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _context(self, request: Request) -> dict[str, Any]:
        return {"request": request, "user": _user(request)}

    def _detail(self, request: Request, invoice: SalesInvoice) -> dict[str, Any]:
        return SalesInvoiceDetailSerializer(invoice, context=self._context(request)).data

    def _build_lines(self, tenant: Any, raw_lines: list[dict[str, Any]]) -> list[Any]:
        lines = []
        for raw in raw_lines:
            variant = get_or_404(tenant, ItemVariant, raw["variant"], "Variant")
            lines.append(
                services.SaleLineInput(
                    variant=variant,
                    qty=raw["qty"],
                    unit_price=raw.get("unit_price"),
                    discount=raw.get("discount", 0),
                )
            )
        return lines


class SaleListView(_SalesAPIView):
    plan_usage_by_method: ClassVar[dict[str, str]] = {"POST": "max_invoices_per_month"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=SalesInvoiceSerializer,
            response_many=True,
            paginated=True,
        ),
        "POST": operation(
            request=SaleCreateSerializer,
            response=SalesInvoiceDetailSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_invoices(
            tenant,
            _user(request),
            status=request.query_params.get("status", ""),
            doc_type=request.query_params.get("doc_type", ""),
            branch_id=_uuid_param(request, "branch"),
            customer_id=_uuid_param(request, "customer"),
            invoice_no=_invoice_no_param(request),
            date_from=_date_param(request, "date_from"),
            date_to=_date_param(request, "date_to"),
            date_from_bs=request.query_params.get("date_from_bs", ""),
            date_to_bs=request.query_params.get("date_to_bs", ""),
        )
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = SalesInvoiceSerializer(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        key = _idempotency_key(request)
        serializer = SaleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch = get_or_404(tenant, Branch, data["branch"], "Branch")
        rate_type = get_or_404(tenant, RateType, data["rate_type"], "Rate type")
        customer = (
            get_or_404(tenant, Customer, data["customer"], "Customer")
            if data.get("customer")
            else None
        )
        result = services.create_sale(
            tenant,
            branch=branch,
            rate_type=rate_type,
            customer=customer,
            lines=self._build_lines(tenant, data["lines"]),
            payments=data.get("payments", []),
            is_vat_bill=data.get("is_vat_bill", False),
            bill_discount=data.get("bill_discount", 0),
            round_off=data.get("round_off", 0),
            device_id=data.get("device_id"),
            idempotency_key=key,
            created_by=_user(request),
            override_reason=data.get("override_reason", ""),
            require_open_cash_session=True,
        )
        http_status = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        response = ok(self._detail(request, result.invoice), http_status)
        if result.replayed:
            response["X-Idempotent-Replay"] = "true"
        return response


class SaleDetailView(_SalesAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=SalesInvoiceDetailSerializer),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        invoice = selectors.get_invoice(tenant, _user(request), pk)
        if invoice is None:
            return error(404, "INVOICE_NOT_FOUND", "Invoice not found.")
        return ok(self._detail(request, invoice))


class ReceiptPrintView(_SalesAPIView):
    """POST /sales/<id>/print — append an immutable print audit event."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "sale.create"}
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        invoice = get_or_404(tenant, SalesInvoice, pk, "Invoice")
        print_count = services.record_receipt_print(tenant, invoice=invoice, actor=_user(request))
        return ok({"id": str(pk), "print_count": print_count})


class HoldBillView(_SalesAPIView):
    """POST /sales/hold — park a bill (no stock, no invoice number)."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=HoldBillSerializer,
            response=SalesInvoiceDetailSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        key = _idempotency_key(request)
        serializer = HoldBillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch = get_or_404(tenant, Branch, data["branch"], "Branch")
        rate_type = get_or_404(tenant, RateType, data["rate_type"], "Rate type")
        customer = (
            get_or_404(tenant, Customer, data["customer"], "Customer")
            if data.get("customer")
            else None
        )
        result = services.hold_bill(
            tenant,
            branch=branch,
            rate_type=rate_type,
            customer=customer,
            lines=self._build_lines(tenant, data["lines"]),
            is_vat_bill=data.get("is_vat_bill", False),
            bill_discount=data.get("bill_discount", 0),
            round_off=data.get("round_off", 0),
            device_id=data.get("device_id"),
            idempotency_key=key,
            created_by=_user(request),
            override_reason=data.get("override_reason", ""),
        )
        http_status = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        return ok(self._detail(request, result.invoice), http_status)


class HeldBillListView(_SalesAPIView):
    """GET /sales/held — parked bills (the resume list)."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=SalesInvoiceSerializer,
            response_many=True,
            paginated=True,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_invoices(tenant, _user(request), status=SalesInvoice.Status.HELD)
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = SalesInvoiceSerializer(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)


class CompleteBillView(_SalesAPIView):
    """POST /sales/<id>/complete — finish a held bill with tender."""

    plan_usage_by_method: ClassVar[dict[str, str]] = {"POST": "max_invoices_per_month"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=CompleteBillSerializer,
            response=SalesInvoiceDetailSerializer,
        ),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        serializer = CompleteBillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice = get_or_404(tenant, SalesInvoice, pk, "Invoice")
        completed = services.complete_held_bill(
            tenant,
            invoice=invoice,
            payments=serializer.validated_data.get("payments", []),
            created_by=_user(request),
            override_reason=serializer.validated_data.get("override_reason", ""),
            require_open_cash_session=True,
        )
        return ok(self._detail(request, completed))


class CancelBillView(_SalesAPIView):
    """POST /sales/<id>/cancel — void a held bill (sale.void)."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "sale.void"}
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        invoice = get_or_404(tenant, SalesInvoice, pk, "Invoice")
        cancelled = services.cancel_held_bill(tenant, invoice=invoice)
        return ok({"id": str(pk), "status": cancelled.status})


class SaleShareView(_SalesAPIView):
    """POST /sales/<id>/share — idempotent public-link token (sale.view)."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "sale.view"}
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        invoice = get_or_404(tenant, SalesInvoice, pk, "Invoice")
        shared = services.get_or_create_share_token(tenant, invoice=invoice, actor=_user(request))
        assert shared.share_token is not None  # set by the service
        return ok(
            {
                "share_token": str(shared.share_token),
                "share_url_path": f"/bill/{shared.share_token}",
            }
        )


class SharedBillView(APIView):
    """GET /sales/shared/<token> — the public online bill (no auth).

    The token is the capability: an unguessable UUID authorizing read of the
    receipt payload only. When the request arrives on a shop subdomain, a
    token minted by ANOTHER tenant is a 404 — never a cross-tenant read.
    """

    permission_classes = (AllowAny,)
    throttle_classes = (SharedBillThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=SharedBillSerializer),
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def get(self, request: Request, token: UUID) -> Response:
        invoice = selectors.get_shared_invoice(token)
        request_tenant = get_request_tenant(request)
        if invoice is None or (
            request_tenant is not None and invoice.tenant_id != request_tenant.pk
        ):
            return error(404, "BILL_NOT_FOUND", "We could not find this bill.")
        return ok(SharedBillSerializer(invoice).data)
