"""DRF views for reports — thin: parse, authorize, delegate.

Reports are BS-native: date params are BS strings 'YYYY-MM-DD' (compared
lexicographically against the denormalized char(10) column — no
conversion anywhere). Defaults per design §5.3: the current BS month.

Permissions per the catalog: report.sales / report.stock / report.ledger /
report.vat. Profit requires BOTH report.profit and pricing.view_cost —
the whole report is cost data (invariant 10).
"""

from typing import Any, ClassVar
from uuid import UUID

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reports import selectors
from apps.reports.exports import (
    XLSX_MEDIA_TYPE,
    ExportFilters,
    build_report_export,
)
from apps.reports.permissions import ReportExportPermission
from core.middleware.tenant import require_request_tenant
from core.openapi import object_list, operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok
from core.throttles import ReportThrottle


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


def _int_param(request: Request, name: str, default: int) -> int:
    raw = request.query_params.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ServiceError("PARAM_INVALID", f"Parameter '{name}' must be an integer.") from exc


def _bs_param(request: Request, name: str) -> str | None:
    raw = request.query_params.get(name)
    return raw.strip() if raw else None


class _ReportsAPIView(APIView):
    permission_classes = (HasPermission,)
    throttle_classes = (ReportThrottle,)
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.sales"}

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _paginate_list(self, request: Request, rows: list[Any]) -> Response:
        """Page/limit over an already-materialized list of row dicts.

        Reports hand over plain lists (not QuerySets), so slicing happens
        here; the envelope meta matches EnvelopePageNumberPagination.
        """
        paginator = EnvelopePageNumberPagination()
        page_size = paginator.get_page_size(request) or 50
        try:
            page_number = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            page_number = 1
        count = len(rows)
        total_pages = max(1, -(-count // page_size))
        start = (page_number - 1) * page_size
        return Response(
            {
                "data": rows[start : start + page_size],
                "meta": {
                    "count": count,
                    "page": page_number,
                    "total_pages": total_pages,
                    "page_size": page_size,
                },
                "error": None,
            }
        )


class DashboardPermission(BasePermission):
    """Allow staff who can use at least one dashboard operation."""

    codes: ClassVar[tuple[str, ...]] = (
        "customer.view",
        "report.ledger",
        "report.profit",
        "report.sales",
        "sale.create",
        "sale.view",
        "stock.view",
    )

    def has_permission(self, request: Request, view: APIView) -> bool:
        del view
        user = request.user
        return bool(
            user and user.is_authenticated and any(user.has_perm(code) for code in self.codes)
        )


class DashboardView(APIView):
    permission_classes = (DashboardPermission,)
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(selectors.dashboard_summary(tenant, _user(request)))


class CollectionsByTenderView(_ReportsAPIView):
    """GET /reports/collections-by-tender — collections grouped by payment
    method (tender) for a branch/period. Same gate as daily sales."""

    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(
            selectors.collections_by_tender(
                tenant,
                _user(request),
                branch_id=_uuid_param(request, "branch"),
                date_from_bs=_bs_param(request, "date_from_bs"),
                date_to_bs=_bs_param(request, "date_to_bs"),
            )
        )


class DailySalesView(_ReportsAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list()),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.daily_sales(
            tenant,
            _user(request),
            branch_id=_uuid_param(request, "branch"),
            date_from_bs=_bs_param(request, "date_from_bs"),
            date_to_bs=_bs_param(request, "date_to_bs"),
        )
        return ok(rows)


class MonthlySalesView(_ReportsAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list()),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.monthly_sales(
            tenant, _user(request), fiscal_year_bs=_bs_param(request, "fiscal_year_bs")
        )
        return ok(rows)


class ItemSalesView(_ReportsAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list(), paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.item_sales(
            tenant,
            _user(request),
            date_from_bs=_bs_param(request, "date_from_bs"),
            date_to_bs=_bs_param(request, "date_to_bs"),
            limit=_int_param(request, "limit", 20),
        )
        return self._paginate_list(request, rows)


class StockSummaryView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.stock"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list(), paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.stock_summary(
            tenant, _user(request), branch_id=_uuid_param(request, "branch")
        )
        return self._paginate_list(request, rows)


class LowStockView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.stock"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list(), paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.low_stock(tenant, _user(request), branch_id=_uuid_param(request, "branch"))
        return self._paginate_list(request, rows)


class DeadStockView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.stock"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list(), paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = selectors.dead_stock(
            tenant,
            _user(request),
            branch_id=_uuid_param(request, "branch"),
            days=_int_param(request, "days", 90),
        )
        return self._paginate_list(request, rows)


class ProfitReportView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.profit"}
    plan_features_by_method: ClassVar[dict[str, str]] = {"GET": "profit_reports"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        user = _user(request)
        if not user.has_perm("pricing.view_cost"):
            raise PermissionDenied(
                detail="Profit reports require cost visibility.", code="COST_VISIBILITY_REQUIRED"
            )
        return ok(
            selectors.profit_report(
                tenant,
                user,
                date_from_bs=_bs_param(request, "date_from_bs"),
                date_to_bs=_bs_param(request, "date_to_bs"),
            )
        )


class DuesReportView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.ledger"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(selectors.dues_report(tenant, _user(request)))


class SalesVatRegisterView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.vat"}
    plan_features_by_method: ClassVar[dict[str, str]] = {"GET": "vat_module"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(
            selectors.sales_vat_register(
                tenant,
                _user(request),
                date_from_bs=_bs_param(request, "date_from_bs"),
                date_to_bs=_bs_param(request, "date_to_bs"),
            )
        )


class PurchaseVatRegisterView(_ReportsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "report.vat"}
    plan_features_by_method: ClassVar[dict[str, str]] = {"GET": "vat_module"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(
            selectors.purchase_vat_register(
                tenant,
                _user(request),
                date_from_bs=_bs_param(request, "date_from_bs"),
                date_to_bs=_bs_param(request, "date_to_bs"),
            )
        )


class ReportExportView(APIView):
    """Download one permission-filtered report as an XLSX workbook."""

    permission_classes = (ReportExportPermission,)
    throttle_classes = (ReportThrottle,)
    plan_features_by_method: ClassVar[dict[str, str]] = {"GET": "export_excel"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=OpenApiTypes.BINARY,
            raw_response=True,
            response_media_type=XLSX_MEDIA_TYPE,
        )
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def get(self, request: Request) -> HttpResponse:
        tenant = require_request_tenant(request)
        content, filename = build_report_export(
            tenant,
            _user(request),
            report_name=request.query_params.get("report", ""),
            filters=ExportFilters(
                branch_id=_uuid_param(request, "branch"),
                date_from_bs=_bs_param(request, "date_from_bs"),
                date_to_bs=_bs_param(request, "date_to_bs"),
                fiscal_year_bs=_bs_param(request, "fiscal_year_bs"),
                days=_int_param(request, "days", 90),
                limit=_int_param(request, "limit", 20),
            ),
        )
        response = HttpResponse(content, content_type=XLSX_MEDIA_TYPE)
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["X-Content-Type-Options"] = "nosniff"
        return response
