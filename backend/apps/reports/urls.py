"""URL routes for reports."""

from django.urls import path

from apps.reports.views import (
    CollectionsByTenderView,
    DailySalesView,
    DashboardView,
    DeadStockView,
    DuesReportView,
    ItemSalesView,
    LowStockView,
    MonthlySalesView,
    ProfitReportView,
    PurchaseVatRegisterView,
    SalesVatRegisterView,
    StockSummaryView,
)

app_name = "reports"

urlpatterns = [
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    path(
        "reports/collections-by-tender",
        CollectionsByTenderView.as_view(),
        name="collections-by-tender",
    ),
    path("reports/daily-sales", DailySalesView.as_view(), name="daily-sales"),
    path("reports/monthly-sales", MonthlySalesView.as_view(), name="monthly-sales"),
    path("reports/item-sales", ItemSalesView.as_view(), name="item-sales"),
    path("reports/stock-summary", StockSummaryView.as_view(), name="stock-summary"),
    path("reports/low-stock", LowStockView.as_view(), name="low-stock"),
    path("reports/dead-stock", DeadStockView.as_view(), name="dead-stock"),
    path("reports/profit", ProfitReportView.as_view(), name="profit"),
    path("reports/dues", DuesReportView.as_view(), name="dues"),
    path("reports/vat-register/sales", SalesVatRegisterView.as_view(), name="vat-sales"),
    path(
        "reports/vat-register/purchase",
        PurchaseVatRegisterView.as_view(),
        name="vat-purchase",
    ),
]
