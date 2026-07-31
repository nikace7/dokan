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

from apps.catalog.models import ItemVariant
from apps.purchasing import selectors, services
from apps.purchasing.models import PurchaseInvoice, Supplier
from apps.purchasing.serializers import (
    PurchaseInvoiceCreateSerializer,
    PurchaseInvoiceSerializer,
    PurchaseInvoiceUpdateSerializer,
    SupplierSerializer,
)
from apps.tenants.models import Branch
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


def _date_param(request: Request, name: str) -> Any:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        from datetime import date as _date

        return _date.fromisoformat(raw)
    except ValueError as exc:
        raise ServiceError(
            "DATE_INVALID", f"Query parameter '{name}' must be an ISO date (YYYY-MM-DD)."
        ) from exc


def _uuid_param(request: Request, name: str) -> UUID | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


class InvoiceListView(_PurchasingAPIView):
    def get(self, request: Request) -> Response:

        tenant = require_request_tenant(request)
        qs = selectors.list_invoices(
            tenant,
            _user(request),
            status=request.query_params.get("status", ""),
            supplier_id=_uuid_param(request, "supplier"),
            date_from=_date_param(request, "date_from"),
            date_to=_date_param(request, "date_to"),
        )
        return self._paginated(request, qs, PurchaseInvoiceSerializer)

    def post(self, request: Request) -> Response:

        tenant = require_request_tenant(request)
        serializer = PurchaseInvoiceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        branch = _get_or_404(tenant, Branch, data["branch"], "Branch")
        supplier = _get_or_404(tenant, Supplier, data["supplier"], "Supplier")
        lines = [
            {
                "variant": _get_or_404(tenant, ItemVariant, raw["variant"], "Variant"),
                "qty": raw["qty"],
                "unit_cost": raw["unit_cost"],
                "discount": raw.get("discount", 0),
            }
            for raw in data["lines"]
        ]
        invoice = services.create_purchase_invoice(
            tenant,
            branch=branch,
            supplier=supplier,
            bill_date_ad=data["bill_date_ad"],
            is_vat_bill=data.get("is_vat_bill", False),
            other_charges=data.get("other_charges", 0),
            paid_amount=data.get("paid_amount", 0),
            note=data.get("note", ""),
            lines=lines,
            created_by=_user(request),
        )
        return ok(
            PurchaseInvoiceSerializer(invoice, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class InvoiceDetailView(_PurchasingAPIView):
    def get(self, request: Request, pk: UUID) -> Response:

        tenant = require_request_tenant(request)
        invoice = _get_or_404(tenant, PurchaseInvoice, pk, "Purchase invoice")
        return ok(PurchaseInvoiceSerializer(invoice, context=self._context(request)).data)

    def patch(self, request: Request, pk: UUID) -> Response:

        tenant = require_request_tenant(request)
        invoice = _get_or_404(tenant, PurchaseInvoice, pk, "Purchase invoice")
        serializer = PurchaseInvoiceUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        fields: dict[str, Any] = {}
        for name in ("bill_date_ad", "is_vat_bill", "other_charges", "paid_amount", "note"):
            if name in data:
                fields[name] = data[name]
        if "supplier" in data:
            fields["supplier"] = _get_or_404(tenant, Supplier, data["supplier"], "Supplier")

        lines = None
        if "lines" in data:
            lines = [
                {
                    "variant": _get_or_404(tenant, ItemVariant, raw["variant"], "Variant"),
                    "qty": raw["qty"],
                    "unit_cost": raw["unit_cost"],
                    "discount": raw.get("discount", 0),
                }
                for raw in data["lines"]
            ]
        invoice = services.update_purchase_invoice(
            tenant, invoice=invoice, fields=fields, lines=lines
        )
        return ok(PurchaseInvoiceSerializer(invoice, context=self._context(request)).data)


class InvoiceConfirmView(_PurchasingAPIView):
    """POST /purchasing/invoices/<id>/confirm — post stock + batches."""

    def post(self, request: Request, pk: UUID) -> Response:

        tenant = require_request_tenant(request)
        invoice = _get_or_404(tenant, PurchaseInvoice, pk, "Purchase invoice")
        invoice = services.confirm_purchase_invoice(
            tenant, invoice=invoice, created_by=_user(request)
        )
        return ok(PurchaseInvoiceSerializer(invoice, context=self._context(request)).data)


class InvoiceCancelView(_PurchasingAPIView):
    """POST /purchasing/invoices/<id>/cancel — void a DRAFT."""

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        invoice = _get_or_404(tenant, PurchaseInvoice, pk, "Purchase invoice")
        invoice = services.cancel_purchase_invoice(tenant, invoice=invoice)
        return ok({"id": str(pk), "status": invoice.status})
