"""Permission-aware report selection and safe XLSX rendering."""

from __future__ import annotations

import json
from dataclasses import dataclass
from io import BytesIO
from typing import TYPE_CHECKING, Any, Final
from uuid import UUID

from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.reports import selectors
from apps.tenants.selectors import is_feature_enabled
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

XLSX_MEDIA_TYPE: Final = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_FORMULA_PREFIXES: Final = ("=", "+", "-", "@")


@dataclass(frozen=True)
class ExportFilters:
    """Validated query values accepted by the report selectors."""

    branch_id: UUID | None = None
    date_from_bs: str | None = None
    date_to_bs: str | None = None
    fiscal_year_bs: str | None = None
    days: int = 90
    limit: int = 20


@dataclass(frozen=True)
class ReportSpec:
    permission: str
    plan_feature: str | None = None


REPORT_SPECS: Final[dict[str, ReportSpec]] = {
    "collections-by-tender": ReportSpec("report.sales"),
    "daily-sales": ReportSpec("report.sales"),
    "dead-stock": ReportSpec("report.stock"),
    "dues": ReportSpec("report.ledger"),
    "item-sales": ReportSpec("report.sales"),
    "low-stock": ReportSpec("report.stock"),
    "monthly-sales": ReportSpec("report.sales"),
    "profit": ReportSpec("report.profit", "profit_reports"),
    "stock-summary": ReportSpec("report.stock"),
    "vat-purchase": ReportSpec("report.vat", "vat_module"),
    "vat-sales": ReportSpec("report.vat", "vat_module"),
}


def required_report_permission(report_name: str) -> str | None:
    """Return the route permission, leaving invalid names to the service."""
    spec = REPORT_SPECS.get(report_name)
    return spec.permission if spec is not None else None


def safe_spreadsheet_cell(value: Any) -> Any:
    """Prevent untrusted text from being interpreted as an Excel formula."""
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, str) and value.lstrip().startswith(_FORMULA_PREFIXES):
        return f"'{value}"
    return value


def _require_access(tenant: Tenant, user: User, report_name: str) -> ReportSpec:
    spec = REPORT_SPECS.get(report_name)
    if spec is None:
        raise ServiceError("REPORT_INVALID", "Choose a supported report to export.")
    if not is_feature_enabled(tenant, "export_excel"):
        raise ServiceError(
            "PLAN_FEATURE_REQUIRED",
            "Excel export is not included in your current plan.",
            http_status=402,
        )
    if not user.has_perm(spec.permission):
        raise ServiceError(
            "PERMISSION_DENIED",
            "You do not have permission to export this report.",
            http_status=403,
        )
    if spec.plan_feature and not is_feature_enabled(tenant, spec.plan_feature):
        raise ServiceError(
            "PLAN_FEATURE_REQUIRED",
            "This report is not included in your current plan.",
            http_status=402,
        )
    if report_name == "profit" and not user.has_perm("pricing.view_cost"):
        raise ServiceError(
            "COST_VISIBILITY_REQUIRED",
            "Profit reports require cost visibility.",
            http_status=403,
        )
    return spec


def _select_report(
    tenant: Tenant,
    user: User,
    report_name: str,
    filters: ExportFilters,
) -> Any:
    common_dates = {
        "date_from_bs": filters.date_from_bs,
        "date_to_bs": filters.date_to_bs,
    }
    if report_name == "daily-sales":
        return selectors.daily_sales(tenant, user, branch_id=filters.branch_id, **common_dates)
    if report_name == "monthly-sales":
        return selectors.monthly_sales(tenant, user, fiscal_year_bs=filters.fiscal_year_bs)
    if report_name == "item-sales":
        return selectors.item_sales(tenant, user, limit=filters.limit, **common_dates)
    if report_name == "collections-by-tender":
        return selectors.collections_by_tender(
            tenant, user, branch_id=filters.branch_id, **common_dates
        )
    if report_name == "stock-summary":
        return selectors.stock_summary(tenant, user, branch_id=filters.branch_id)
    if report_name == "low-stock":
        return selectors.low_stock(tenant, user, branch_id=filters.branch_id)
    if report_name == "dead-stock":
        return selectors.dead_stock(tenant, user, branch_id=filters.branch_id, days=filters.days)
    if report_name == "profit":
        return selectors.profit_report(tenant, user, **common_dates)
    if report_name == "dues":
        return selectors.dues_report(tenant, user)
    if report_name == "vat-sales":
        return selectors.sales_vat_register(tenant, user, **common_dates)
    return selectors.purchase_vat_register(tenant, user, **common_dates)


def _rows_and_summaries(result: Any) -> list[tuple[str, list[dict[str, Any]], dict[str, Any]]]:
    if isinstance(result, list):
        return [("Report", result, {})]
    if not isinstance(result, dict):
        return [("Report", [{"value": result}], {})]
    if "receivables" in result or "payables" in result:
        return [
            ("Receivables", result.get("receivables", []), {}),
            ("Payables", result.get("payables", []), {}),
        ]
    rows_key = "rows" if "rows" in result else "methods"
    rows = result.get(rows_key, [])
    summary = {
        key: value
        for key, value in result.items()
        if key not in {rows_key, "date_from_bs", "date_to_bs"}
    }
    if isinstance(summary.get("totals"), dict):
        totals = summary.pop("totals")
        summary.update({f"total_{key}": value for key, value in totals.items()})
    return [("Report", rows, summary)]


def _header(value: str) -> str:
    return value.replace("_", " ").title()


def _append_sheet(
    workbook: Workbook,
    *,
    title: str,
    tenant_name: str,
    report_name: str,
    filters: ExportFilters,
    rows: list[dict[str, Any]],
    summary: dict[str, Any],
) -> None:
    sheet = workbook.create_sheet(title=title[:31])
    sheet.append([_header(report_name), safe_spreadsheet_cell(tenant_name)])
    sheet.append(["Generated At", timezone.localtime().isoformat(timespec="seconds")])
    filter_values = {
        "Date From BS": filters.date_from_bs,
        "Date To BS": filters.date_to_bs,
        "Fiscal Year BS": filters.fiscal_year_bs,
        "Branch": str(filters.branch_id) if filters.branch_id else None,
    }
    for label, value in filter_values.items():
        if value:
            sheet.append([label, safe_spreadsheet_cell(value)])
    sheet.append([])

    columns = list(dict.fromkeys(key for row in rows for key in row))
    header_row = sheet.max_row + 1
    if columns:
        sheet.append([_header(column) for column in columns])
        for row in rows:
            sheet.append([safe_spreadsheet_cell(row.get(column)) for column in columns])
    else:
        sheet.append(["No data for the selected filters."])

    if summary:
        sheet.append([])
        sheet.append(["Summary"])
        for key, value in summary.items():
            sheet.append([_header(key), safe_spreadsheet_cell(value)])

    heading_fill = PatternFill("solid", fgColor="1D4ED8")
    for cell in sheet[header_row]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = heading_fill
        cell.alignment = Alignment(horizontal="center")
    sheet.freeze_panes = f"A{header_row + 1}"
    sheet.auto_filter.ref = (
        f"A{header_row}:{get_column_letter(max(1, len(columns)))}{sheet.max_row}"
    )
    for index, column_cells in enumerate(sheet.columns, start=1):
        width = max(len(str(cell.value or "")) for cell in column_cells)
        sheet.column_dimensions[get_column_letter(index)].width = min(max(width + 2, 12), 45)


def build_report_export(
    tenant: Tenant,
    user: User,
    *,
    report_name: str,
    filters: ExportFilters,
) -> tuple[bytes, str]:
    """Authorize, select, and render one immutable workbook snapshot."""
    _require_access(tenant, user, report_name)
    result = _select_report(tenant, user, report_name, filters)

    workbook = Workbook()
    active_sheet = workbook.active
    if active_sheet is not None:
        workbook.remove(active_sheet)
    for title, rows, summary in _rows_and_summaries(result):
        _append_sheet(
            workbook,
            title=title,
            tenant_name=tenant.name,
            report_name=report_name,
            filters=filters,
            rows=rows,
            summary=summary,
        )
    output = BytesIO()
    workbook.save(output)
    filename = f"{report_name}-{timezone.localdate().isoformat()}.xlsx"
    return output.getvalue(), filename
