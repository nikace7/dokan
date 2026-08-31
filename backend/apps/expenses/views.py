"""DRF views for expenses — thin: parse, authorize, delegate.

Permissions: ``expense.view`` for reads (list, detail, summary),
``expense.manage`` for writes. Chosen over report.expense because these
are operational CRUD endpoints, not reports; report.expense stays for
the reports-app expense report when that lands.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.expenses import selectors, services
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.serializers import (
    ExpenseCategorySerializer,
    ExpenseCreateSerializer,
    ExpenseSerializer,
    ExpenseUpdateSerializer,
)
from apps.tenants.models import Branch
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "expense.view",
    "POST": "expense.manage",
    "PATCH": "expense.manage",
    "DELETE": "expense.manage",
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


class _ExpensesAPIView(APIView):
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


class CategoryListView(_ExpensesAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=ExpenseCategorySerializer,
            response_many=True,
            paginated=True,
        ),
        "POST": operation(
            request=ExpenseCategorySerializer,
            response=ExpenseCategorySerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        raw = request.query_params.get("is_active")
        is_active = None if raw is None else raw.lower() in {"1", "true", "yes"}
        qs = selectors.list_categories(tenant, _user(request), is_active=is_active)
        return self._paginated(request, qs, ExpenseCategorySerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = ExpenseCategorySerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        category = services.create_category(tenant, **serializer.validated_data)
        return ok(
            ExpenseCategorySerializer(category, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class CategoryDetailView(_ExpensesAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(
            request=ExpenseCategorySerializer,
            response=ExpenseCategorySerializer,
        ),
        "DELETE": operation(),
    }

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        category = _get_or_404(tenant, ExpenseCategory, pk, "Category")
        serializer = ExpenseCategorySerializer(
            category, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        category = services.update_category(category, **serializer.validated_data)
        return ok(ExpenseCategorySerializer(category, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        category = _get_or_404(tenant, ExpenseCategory, pk, "Category")
        services.deactivate_category(category)
        return ok({"id": str(pk), "is_active": False})


class ExpenseListView(_ExpensesAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ExpenseSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=ExpenseCreateSerializer,
            response=ExpenseSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_expenses(
            tenant,
            _user(request),
            category_id=_uuid_param(request, "category"),
            branch_id=_uuid_param(request, "branch"),
            date_from=_date_param(request, "date_from"),
            date_to=_date_param(request, "date_to"),
            date_from_bs=request.query_params.get("date_from_bs", ""),
            date_to_bs=request.query_params.get("date_to_bs", ""),
        )
        return self._paginated(request, qs, ExpenseSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = ExpenseCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        branch = (
            _get_or_404(tenant, Branch, data["branch"], "Branch") if data.get("branch") else None
        )
        category = _get_or_404(tenant, ExpenseCategory, data["category"], "Category")
        expense = services.create_expense(
            tenant,
            branch=branch,
            category=category,
            amount=data["amount"],
            business_date_ad=data["business_date_ad"],
            payee=data.get("payee", ""),
            note=data.get("note", ""),
            created_by=_user(request),
        )
        return ok(
            ExpenseSerializer(expense, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class ExpenseDetailView(_ExpensesAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ExpenseSerializer),
        "PATCH": operation(request=ExpenseUpdateSerializer, response=ExpenseSerializer),
        "DELETE": operation(),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        expense = _get_or_404(tenant, Expense, pk, "Expense")
        return ok(ExpenseSerializer(expense, context=self._context(request)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        expense = _get_or_404(tenant, Expense, pk, "Expense")
        serializer = ExpenseUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields: dict[str, Any] = dict(serializer.validated_data)
        if "branch" in fields and fields["branch"] is not None:
            fields["branch"] = _get_or_404(tenant, Branch, fields["branch"], "Branch")
        if "category" in fields:
            fields["category"] = _get_or_404(
                tenant, ExpenseCategory, fields["category"], "Category"
            )
        expense = services.update_expense(tenant, expense, **fields)
        return ok(ExpenseSerializer(expense, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        expense = _get_or_404(tenant, Expense, pk, "Expense")
        services.delete_expense(tenant, expense)
        return ok({"id": str(pk), "deleted": True})


class ExpenseSummaryView(_ExpensesAPIView):
    """GET /expenses/summary — totals by category or BS month."""

    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(
            selectors.expense_summary(
                tenant,
                _user(request),
                date_from_bs=request.query_params.get("date_from_bs"),
                date_to_bs=request.query_params.get("date_to_bs"),
                group_by=request.query_params.get("group_by", "category"),
            )
        )
