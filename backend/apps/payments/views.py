"""DRF views for payments — thin: parse, authorize, delegate.

Permissions (seeded in payments.0001): ``payment.receive`` for receipts,
``payment.pay`` for supplier payments, ``payment.view`` for reads and the
aging report, ``payment.reverse`` for payment reversals, ``cash.manage`` for
cash sessions. Receiving money is
counter work — kept out of customer.credit, which governs udharo terms.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.customers.models import Customer
from apps.payments import selectors, services
from apps.payments.models import CashSession, Payment
from apps.payments.serializers import (
    CashSessionCloseSerializer,
    CashSessionOpenSerializer,
    CashSessionSerializer,
    LedgerRowSerializer,
    PaymentReversalSerializer,
    PaymentSerializer,
    ReceiptCreateSerializer,
    SupplierPaymentCreateSerializer,
)
from apps.purchasing.models import PurchaseInvoice, Supplier
from apps.sales.models import SalesInvoice
from apps.tenants.models import Branch
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, not_found_code, ok


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _get_or_404(tenant: Any, model: Any, pk: Any, what: str) -> Any:
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError(not_found_code(what), f"{what} not found.", http_status=404)
    return instance


def _uuid_param(request: Request, name: str) -> UUID | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _date_param(request: Request, name: str) -> Any:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        from datetime import date

        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ServiceError(
            "DATE_INVALID", f"Query parameter '{name}' must be an ISO date (YYYY-MM-DD)."
        ) from exc


def _idempotency_key(request: Request) -> str:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    return key


class _PaymentsAPIView(APIView):
    permission_classes = (HasPermission,)

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _context(self, request: Request) -> dict[str, Any]:
        return {"request": request, "user": _user(request)}

    def _respond(self, request: Request, result: Any) -> Response:
        http_status = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        response = ok(
            PaymentSerializer(result.payment, context=self._context(request)).data, http_status
        )
        if result.replayed:
            response["X-Idempotent-Replay"] = "true"
        return response


class ReceiptCreateView(_PaymentsAPIView):
    """POST /payments/receipts — money IN from a customer."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "payment.receive"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=ReceiptCreateSerializer,
            response=PaymentSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        key = _idempotency_key(request)
        serializer = ReceiptCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch = _get_or_404(tenant, Branch, data["branch"], "Branch")
        customer = _get_or_404(tenant, Customer, data["customer"], "Customer")
        allocations = [
            {
                "sales_invoice": _get_or_404(tenant, SalesInvoice, raw["invoice"], "Invoice"),
                "amount": raw["amount"],
            }
            for raw in data.get("allocations", [])
        ]
        result = services.record_receipt(
            tenant,
            branch=branch,
            customer=customer,
            amount=data["amount"],
            method=data["method"],
            allocations=allocations,
            ref_no=data.get("ref_no", ""),
            note=data.get("note", ""),
            idempotency_key=key,
            created_by=_user(request),
        )
        return self._respond(request, result)


class SupplierPaymentCreateView(_PaymentsAPIView):
    """POST /payments/supplier-payments — money OUT to a supplier."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "payment.pay"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=SupplierPaymentCreateSerializer,
            response=PaymentSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        key = _idempotency_key(request)
        serializer = SupplierPaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch = _get_or_404(tenant, Branch, data["branch"], "Branch")
        supplier = _get_or_404(tenant, Supplier, data["supplier"], "Supplier")
        allocations = [
            {
                "purchase_invoice": _get_or_404(
                    tenant, PurchaseInvoice, raw["invoice"], "Purchase invoice"
                ),
                "amount": raw["amount"],
            }
            for raw in data.get("allocations", [])
        ]
        result = services.record_payment(
            tenant,
            branch=branch,
            supplier=supplier,
            amount=data["amount"],
            method=data["method"],
            allocations=allocations,
            ref_no=data.get("ref_no", ""),
            note=data.get("note", ""),
            idempotency_key=key,
            created_by=_user(request),
        )
        return self._respond(request, result)


class PaymentReverseView(_PaymentsAPIView):
    """POST /payments/<id>/reverse — append a linked counter-entry."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "payment.reverse"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=PaymentReversalSerializer,
            response=PaymentSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        payment = _get_or_404(tenant, Payment, pk, "Payment")
        key = _idempotency_key(request)
        serializer = PaymentReversalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = services.reverse_payment(
            tenant,
            payment=payment,
            reason=serializer.validated_data["reason"],
            idempotency_key=key,
            created_by=_user(request),
        )
        return self._respond(request, result)


class PaymentListView(_PaymentsAPIView):
    """GET /payments — filters: direction/method/party/date range."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "payment.view"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=PaymentSerializer, response_many=True, paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_payments(
            tenant,
            _user(request),
            direction=request.query_params.get("direction", ""),
            method=request.query_params.get("method", ""),
            customer_id=_uuid_param(request, "customer"),
            supplier_id=_uuid_param(request, "supplier"),
            date_from=_date_param(request, "date_from"),
            date_to=_date_param(request, "date_to"),
        )
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = PaymentSerializer(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)


class ReceivablesAgingView(_PaymentsAPIView):
    """GET /payments/reports/receivables-aging — bucketed outstanding.

    Lives under payments (not customers): it is a money report, and its
    rule (per-invoice buckets, unallocated reduces oldest first) is owned
    by the payments selectors.
    """

    method_permissions: ClassVar[dict[str, str]] = {"GET": "payment.view"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(selectors.customer_aging(tenant))


class CashSessionOpenView(_PaymentsAPIView):
    """POST /cash-sessions/open."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "cash.manage"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=CashSessionOpenSerializer,
            response=CashSessionSerializer,
            status_code=201,
        ),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = CashSessionOpenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch = _get_or_404(tenant, Branch, serializer.validated_data["branch"], "Branch")
        session = services.open_session(
            tenant,
            branch=branch,
            opening_float=serializer.validated_data["opening_float"],
            opened_by=_user(request),
            note=serializer.validated_data.get("note", ""),
        )
        return ok(
            CashSessionSerializer(session, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class CashSessionCloseView(_PaymentsAPIView):
    """POST /cash-sessions/<id>/close."""

    method_permissions: ClassVar[dict[str, str]] = {"POST": "cash.manage"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=CashSessionCloseSerializer,
            response=CashSessionSerializer,
        ),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        serializer = CashSessionCloseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = _get_or_404(tenant, CashSession, pk, "Cash session")
        session = services.close_session(
            tenant,
            session=session,
            counted_cash=serializer.validated_data["counted_cash"],
            closed_by=_user(request),
        )
        return ok(CashSessionSerializer(session, context=self._context(request)).data)


class CashSessionCurrentView(_PaymentsAPIView):
    """GET /cash-sessions/current?branch= — the POS drawer guard."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "cash.manage"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        branch_id = _uuid_param(request, "branch")
        if branch_id is None:
            return error(400, "BRANCH_REQUIRED", "Provide a branch query parameter.")
        branch = _get_or_404(tenant, Branch, branch_id, "Branch")
        session = services.get_open_session(tenant, branch)
        if session is None:
            return ok({"session": None})
        return ok({"session": CashSessionSerializer(session, context=self._context(request)).data})


class CustomerLedgerView(_PaymentsAPIView):
    """GET /customers/<id>/ledger — running-balance khata."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "customer.view"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=LedgerRowSerializer, response_many=True),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        customer = _get_or_404(tenant, Customer, pk, "Customer")
        rows = selectors.customer_ledger(tenant, customer)
        return ok(LedgerRowSerializer(rows, many=True).data)


class SupplierLedgerView(_PaymentsAPIView):
    """GET /suppliers/<id>/ledger — running-balance khata."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "stock.view"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=LedgerRowSerializer, response_many=True),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        supplier = _get_or_404(tenant, Supplier, pk, "Supplier")
        rows = selectors.supplier_ledger(tenant, supplier)
        return ok(LedgerRowSerializer(rows, many=True).data)
