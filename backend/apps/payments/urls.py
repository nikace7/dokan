"""URL routes for payments."""

from django.urls import path

from apps.payments.views import (
    CashSessionCloseView,
    CashSessionCurrentView,
    CashSessionOpenView,
    PaymentListView,
    PaymentReverseView,
    ReceiptCreateView,
    ReceivablesAgingView,
    SupplierPaymentCreateView,
)

app_name = "payments"

urlpatterns = [
    path("payments", PaymentListView.as_view(), name="payment-list"),
    path("payments/receipts", ReceiptCreateView.as_view(), name="receipt-create"),
    path("payments/<uuid:pk>/reverse", PaymentReverseView.as_view(), name="payment-reverse"),
    path(
        "payments/supplier-payments",
        SupplierPaymentCreateView.as_view(),
        name="supplier-payment-create",
    ),
    path(
        "payments/reports/receivables-aging",
        ReceivablesAgingView.as_view(),
        name="receivables-aging",
    ),
    path("cash-sessions/open", CashSessionOpenView.as_view(), name="cash-session-open"),
    path("cash-sessions/current", CashSessionCurrentView.as_view(), name="cash-session-current"),
    path(
        "cash-sessions/<uuid:pk>/close",
        CashSessionCloseView.as_view(),
        name="cash-session-close",
    ),
]
