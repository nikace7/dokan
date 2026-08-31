"""Cash-session services for opening, reconciling, and closing a branch drawer."""

from decimal import Decimal
from typing import TYPE_CHECKING

from django.db.models import Sum
from django.utils import timezone

from apps.payments.models import CashSession, Payment
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Branch, Tenant

_ZERO = Decimal("0")


def get_open_session(tenant: "Tenant", branch: "Branch") -> CashSession | None:
    """Return the branch's currently open session, if any."""
    return CashSession.objects.filter(tenant=tenant, branch=branch, closed_at__isnull=True).first()


def require_open_session(tenant: "Tenant", branch: "Branch") -> CashSession:
    """Require an open drawer before a POS completion can move stock."""
    session = get_open_session(tenant, branch)
    if session is None:
        raise ServiceError(
            "CASH_SESSION_REQUIRED",
            "Open a cash session before completing a POS sale.",
            http_status=409,
        )
    return session


def open_session(
    tenant: "Tenant",
    *,
    branch: "Branch",
    opening_float: Decimal,
    opened_by: "User",
    note: str = "",
) -> CashSession:
    """Open the drawer for a branch. One OPEN session per branch."""
    opening_float = quantize_money(opening_float)
    if opening_float < _ZERO:
        raise ServiceError("FLOAT_INVALID", "Opening float cannot be negative.")
    if get_open_session(tenant, branch) is not None:
        raise ServiceError(
            "SESSION_ALREADY_OPEN",
            "This branch already has an open cash session.",
            http_status=409,
        )
    session = CashSession(
        tenant=tenant,
        branch=branch,
        opened_by=opened_by,
        opened_at=timezone.now(),
        opening_float=opening_float,
        note=note or None,
    )
    session.save()
    return session


def _expected_cash(tenant: "Tenant", session: CashSession) -> Decimal:
    """Derive the expected drawer total from persisted cash movements."""
    from apps.sales.models import SalesInvoice

    sales = SalesInvoice.objects.filter(
        tenant=tenant,
        branch=session.branch,
        doc_type=SalesInvoice.DocType.SALE,
        status=SalesInvoice.Status.COMPLETED,
        created_at__gte=session.opened_at,
    ).values_list("tenders", flat=True)
    cash_sales = sum(
        (
            Decimal(str(tender.get("amount", "0")))
            for tenders in sales
            for tender in tenders
            if tender.get("method") == Payment.Method.CASH
        ),
        _ZERO,
    )
    cash_receipts = (
        Payment.objects.filter(
            tenant=tenant,
            branch=session.branch,
            direction=Payment.Direction.RECEIPT,
            method=Payment.Method.CASH,
            created_at__gte=session.opened_at,
        ).aggregate(total=Sum("amount"))["total"]
        or _ZERO
    )
    cash_supplier_payments = (
        Payment.objects.filter(
            tenant=tenant,
            branch=session.branch,
            direction=Payment.Direction.PAYMENT,
            method=Payment.Method.CASH,
            created_at__gte=session.opened_at,
        ).aggregate(total=Sum("amount"))["total"]
        or _ZERO
    )
    returns = SalesInvoice.objects.filter(
        tenant=tenant,
        branch=session.branch,
        doc_type=SalesInvoice.DocType.RETURN,
        created_at__gte=session.opened_at,
    ).values_list("refunds", flat=True)
    cash_refunds = sum(
        (
            Decimal(str(refund.get("amount", "0")))
            for refunds in returns
            for refund in refunds
            if refund.get("method") == Payment.Method.CASH
        ),
        _ZERO,
    )
    return quantize_money(
        session.opening_float + cash_sales + cash_receipts - cash_supplier_payments - cash_refunds
    )


def close_session(
    tenant: "Tenant",
    *,
    session: CashSession,
    counted_cash: Decimal,
    closed_by: "User",
) -> CashSession:
    """Close the drawer and persist expected, counted, and variance snapshots."""
    if session.closed_at is not None:
        raise ServiceError(
            "SESSION_ALREADY_CLOSED", "This cash session is already closed.", http_status=409
        )
    counted_cash = quantize_money(counted_cash)
    if counted_cash < _ZERO:
        raise ServiceError("COUNT_INVALID", "Counted cash cannot be negative.")
    session.expected_cash = _expected_cash(tenant, session)
    session.counted_cash = counted_cash
    session.variance = quantize_money(counted_cash - session.expected_cash)
    session.closed_by = closed_by
    session.closed_at = timezone.now()
    session.save()
    return session
