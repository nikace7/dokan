"""DRF views for customers — thin: parse, authorize, delegate.

Permissions: ``customer.view`` for reads, ``customer.manage`` for writes.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.customers import selectors, services
from apps.customers.models import Customer
from apps.customers.serializers import CustomerSerializer
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, get_or_404, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "customer.view",
    "POST": "customer.manage",
    "PATCH": "customer.manage",
    "DELETE": "customer.manage",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


class _CustomerAPIView(APIView):
    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = _METHOD_PERMISSIONS

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _context(self, request: Request) -> dict[str, Any]:
        return {"request": request, "user": _user(request)}


class CustomerListView(_CustomerAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=CustomerSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=CustomerSerializer,
            response=CustomerSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        raw = request.query_params.get("is_active")
        is_active = None if raw is None else raw.lower() in {"1", "true", "yes"}
        qs = selectors.list_customers(
            tenant,
            _user(request),
            is_active=is_active,
            search=request.query_params.get("search", ""),
        )
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = CustomerSerializer(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = CustomerSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        customer = services.create_customer(
            tenant, actor=_user(request), **serializer.validated_data
        )
        return ok(
            CustomerSerializer(customer, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class CustomerDetailView(_CustomerAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=CustomerSerializer),
        "PATCH": operation(request=CustomerSerializer, response=CustomerSerializer),
        "DELETE": operation(),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        customer = get_or_404(tenant, Customer, pk, "Customer")
        return ok(CustomerSerializer(customer, context=self._context(request)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        customer = get_or_404(tenant, Customer, pk, "Customer")
        serializer = CustomerSerializer(
            customer, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        customer = services.update_customer(
            customer, actor=_user(request), **serializer.validated_data
        )
        return ok(CustomerSerializer(customer, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        customer = get_or_404(tenant, Customer, pk, "Customer")
        services.deactivate_customer(customer)
        return ok({"id": str(pk), "is_active": False})


class CustomerOutstandingView(_CustomerAPIView):
    """GET /customers/<id>/outstanding — dues minus credit notes."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "customer.view"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        customer = get_or_404(tenant, Customer, pk, "Customer")
        breakdown = selectors.get_customer_outstanding_breakdown(tenant, customer)
        return ok(
            {
                "customer": str(customer.pk),
                "opening_balance": str(breakdown["opening_balance"]),
                "due_amount": str(breakdown["due_amount"]),
                "credit_notes": str(breakdown["credit_notes"]),
                "receipts": str(breakdown["receipts"]),
                "outstanding": str(breakdown["outstanding"]),
                "credit_limit": (
                    str(customer.credit_limit) if customer.credit_limit is not None else None
                ),
            }
        )
