"""Pure sale-line, total, tender, and credit calculations."""

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

from django.db.models import Sum

from apps.pricing.services import assert_price_within_bounds, resolve_price
from apps.sales.models import SalesInvoice
from apps.tenants.services import require_plan_feature
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import ItemVariant
    from apps.pricing.models import RateType
    from apps.tenants.models import Tenant

VAT_RATE: Final = Decimal("0.13")
PAYMENT_METHODS = frozenset(
    {"CASH", "ESEWA", "KHALTI", "FONEPAY", "QR", "CARD", "BANK", "CREDIT", "POINTS"}
)
_ZERO = Decimal("0")


@dataclass(frozen=True)
class SaleLineInput:
    variant: "ItemVariant"
    qty: Decimal
    unit_price: Decimal | None
    discount: Decimal


@dataclass(frozen=True)
class ResolvedLine:
    variant: "ItemVariant"
    qty: Decimal
    unit_price: Decimal
    discount: Decimal
    gross: Decimal
    line_total: Decimal
    cost_at_sale: Decimal
    vat_applicable: bool


def resolve_lines(
    tenant: "Tenant",
    *,
    rate_type: "RateType",
    lines: list[SaleLineInput],
    user: "User",
    override_reason: str,
) -> list[ResolvedLine]:
    """Resolve every line's price and validate quantity and guardrails."""
    resolved: list[ResolvedLine] = []
    for line in lines:
        qty = Decimal(line.qty)
        if qty <= _ZERO:
            raise ServiceError("QTY_INVALID", "Line quantity must be greater than zero.")
        if line.unit_price is None:
            unit_price = resolve_price(
                tenant, variant=line.variant, rate_type=rate_type, user=user
            ).price
        else:
            unit_price = quantize_money(line.unit_price)
            assert_price_within_bounds(
                tenant,
                variant=line.variant,
                price=unit_price,
                user=user,
                reason=override_reason,
            )
        discount = quantize_money(line.discount)
        gross = quantize_money(qty * unit_price)
        if discount < _ZERO or discount > gross:
            raise ServiceError(
                "DISCOUNT_INVALID", "Line discount must be between zero and the line amount."
            )
        resolved.append(
            ResolvedLine(
                variant=line.variant,
                qty=qty,
                unit_price=unit_price,
                discount=discount,
                gross=gross,
                line_total=quantize_money(gross - discount),
                cost_at_sale=quantize_money(line.variant.avg_cost),
                vat_applicable=bool(line.variant.item.is_vat_applicable),
            )
        )
    return resolved


def compute_totals(
    tenant: "Tenant",
    *,
    resolved: list[ResolvedLine],
    is_vat_bill: bool,
    bill_discount: Decimal,
    round_off: Decimal,
) -> dict[str, Decimal]:
    """Compute invoice totals using the documented VAT-exclusive rule."""
    if is_vat_bill:
        require_plan_feature(tenant, "vat_module")
    subtotal = quantize_money(sum(line.gross for line in resolved))
    discount_amount = quantize_money(sum(line.discount for line in resolved) + bill_discount)
    if bill_discount < _ZERO or discount_amount > subtotal:
        raise ServiceError(
            "DISCOUNT_INVALID", "Bill discount must be between zero and the subtotal."
        )
    taxable_amount = quantize_money(subtotal - discount_amount)
    vat_amount = _ZERO
    if is_vat_bill and tenant.vat_registered:
        vat_base = sum(line.line_total for line in resolved if line.vat_applicable)
        vat_amount = quantize_money(vat_base * VAT_RATE)
    total = quantize_money(taxable_amount + vat_amount + quantize_money(round_off))
    return {
        "subtotal": subtotal,
        "discount_amount": discount_amount,
        "taxable_amount": taxable_amount,
        "vat_amount": vat_amount,
        "total": total,
    }


def split_payments(*, total: Decimal, payments: list[dict[str, Any]]) -> tuple[Decimal, Decimal]:
    """Return paid and due amounts, enforcing the explicit credit tender."""
    paid = _ZERO
    credit = _ZERO
    for payment in payments:
        if payment["method"] not in PAYMENT_METHODS:
            raise ServiceError(
                "PAYMENT_METHOD_INVALID", f"Unknown payment method: {payment['method']}."
            )
        amount = quantize_money(payment["amount"])
        if amount <= _ZERO:
            raise ServiceError("PAYMENT_AMOUNT_INVALID", "Payment amounts must be positive.")
        if payment["method"] == "CREDIT":
            credit += amount
        else:
            paid += amount
    paid = quantize_money(paid)
    if paid > total:
        raise ServiceError("OVERPAYMENT", "Payments exceed the bill total.")
    due = quantize_money(total - paid)
    if credit > _ZERO and credit != due:
        raise ServiceError(
            "CREDIT_TENDER_MISMATCH",
            "The credit tender amount must equal the remaining due.",
        )
    return paid, due


def check_credit(tenant: "Tenant", *, customer: Any, due: Decimal) -> None:
    """Enforce the customer requirement and configured udharo limit."""
    if due <= _ZERO:
        return
    if customer is None:
        raise ServiceError(
            "UDHARO_REQUIRES_CUSTOMER", "A credit (udharo) sale requires a customer."
        )
    if customer.credit_limit is None:
        return
    existing_dues = (
        SalesInvoice.objects.filter(
            tenant=tenant, customer=customer, status=SalesInvoice.Status.COMPLETED
        ).aggregate(total=Sum("due_amount"))["total"]
        or _ZERO
    )
    if existing_dues + due > customer.credit_limit:
        raise ServiceError(
            "CREDIT_LIMIT_EXCEEDED", "This sale would exceed the customer's credit limit."
        )
