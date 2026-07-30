"""Sales service tests — the invariants are the point.

Money-critical: apps/sales/services must stay at 100% coverage (AGENTS.md).
Covered: totals + VAT rule, stock ledger posting, gapless numbering,
idempotent replay, cost_at_sale snapshot, credit rules, held-bill flow,
and completed-invoice immutability.
"""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.models import StockLevel, StockMovement
from apps.inventory.services import post_opening_stock
from apps.sales import services
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from core.responses import ServiceError
from tests.factories import (
    BranchFactory,
    CustomerFactory,
    ItemFactory,
    ItemVariantFactory,
    RateTypeFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop() -> dict[str, Any]:
    """A shop with two stocked variants: A (VAT-able, MRP 1000), B (no MRP)."""
    tenant = TenantFactory(vat_registered=True)
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant, invoice_prefix="INV")
    rate_type = RateTypeFactory(tenant=tenant, code="RETAIL", is_default=True)

    item_a = ItemFactory(tenant=tenant, is_vat_applicable=True)
    variant_a = ItemVariantFactory(tenant=tenant, item=item_a, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_a,
        qty=Decimal("10"),
        unit_cost=Decimal("600.00"),
        created_by=user,
    )

    item_b = ItemFactory(tenant=tenant, is_vat_applicable=False)
    variant_b = ItemVariantFactory(tenant=tenant, item=item_b, mrp=None)
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_b,
        qty=Decimal("5"),
        unit_cost=Decimal("300.00"),
        created_by=user,
    )

    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant_a": variant_a,
        "variant_b": variant_b,
        "customer": CustomerFactory(tenant=tenant, credit_limit=Decimal("10000.00")),
    }


def _sale(shop: dict, **overrides: Any) -> Any:
    """The reference sale: 2×A (resolved, 100 line discount) + 1×B (explicit 500)."""
    kwargs: dict[str, Any] = {
        "branch": shop["branch"],
        "rate_type": shop["rate_type"],
        "customer": shop["customer"],
        "lines": [
            services.SaleLineInput(
                variant=shop["variant_a"],
                qty=Decimal("2"),
                unit_price=None,
                discount=Decimal("100"),
            ),
            services.SaleLineInput(
                variant=shop["variant_b"],
                qty=Decimal("1"),
                unit_price=Decimal("500.00"),
                discount=Decimal("0"),
            ),
        ],
        "payments": [{"method": "CASH", "amount": Decimal("2000.00")}],
        "is_vat_bill": True,
        "bill_discount": Decimal("100.00"),
        "idempotency_key": "key-1",
        "created_by": shop["user"],
    }
    kwargs.update(overrides)
    return services.create_sale(shop["tenant"], **kwargs)


class TestCreateSaleHappyPath:
    def test_totals_stock_number_and_snapshot(self, shop: dict) -> None:
        result = _sale(shop)
        assert result.replayed is False
        invoice = result.invoice

        # Totals: subtotal 2500, discounts 200, taxable 2300,
        # VAT 13% of VAT-able line total 1900 = 247, total 2547, due 547.
        assert invoice.subtotal == Decimal("2500.00")
        assert invoice.discount_amount == Decimal("200.00")
        assert invoice.taxable_amount == Decimal("2300.00")
        assert invoice.vat_amount == Decimal("247.00")
        assert invoice.total == Decimal("2547.00")
        assert invoice.paid_amount == Decimal("2000.00")
        assert invoice.due_amount == Decimal("547.00")
        assert invoice.status == SalesInvoice.Status.COMPLETED
        assert invoice.invoice_no == 1  # gapless, first bill
        assert invoice.fiscal_year_bs  # denormalized

        # Stock: A 10→8, B 5→4; SALE movements with invoice ref and cost.
        level_a = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        level_b = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_b"])
        assert level_a.qty_on_hand == Decimal("8")
        assert level_b.qty_on_hand == Decimal("4")
        movements = StockMovement.objects.filter(
            type=StockMovement.MovementType.SALE, ref_id=invoice.pk
        )
        assert movements.count() == 2
        assert all(m.ref_type == "sales_invoice" for m in movements)

        # cost_at_sale snapshot from avg_cost at sale time.
        items = {i.variant_id: i for i in SalesInvoiceItem.objects.filter(invoice=invoice)}
        assert items[shop["variant_a"].pk].cost_at_sale == Decimal("600.00")
        assert items[shop["variant_b"].pk].cost_at_sale == Decimal("300.00")

    def test_second_sale_gets_next_number(self, shop: dict) -> None:
        _sale(shop)
        result = _sale(shop, idempotency_key="key-2")
        assert result.invoice.invoice_no == 2

    def test_vat_only_when_tenant_registered_and_flagged(self, shop: dict) -> None:
        shop["tenant"].vat_registered = False
        shop["tenant"].save()
        result = _sale(shop)
        assert result.invoice.vat_amount == Decimal("0")
        assert result.invoice.total == Decimal("2300.00")

    def test_not_vat_bill_means_zero_vat(self, shop: dict) -> None:
        result = _sale(shop, is_vat_bill=False)
        assert result.invoice.vat_amount == Decimal("0")


class TestIdempotency:
    def test_replay_returns_original(self, shop: dict) -> None:
        first = _sale(shop)
        second = _sale(shop)  # same idempotency key
        assert second.replayed is True
        assert second.invoice.pk == first.invoice.pk
        assert SalesInvoice.objects.filter(tenant=shop["tenant"]).count() == 1
        assert StockMovement.objects.filter(type=StockMovement.MovementType.SALE).count() == 2
        # Stock decremented exactly once.
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level.qty_on_hand == Decimal("8")

    def test_missing_key_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, idempotency_key="  ")
        assert exc.value.code == "IDEMPOTENCY_KEY_REQUIRED"

    def test_no_lines_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, lines=[])
        assert exc.value.code == "LINES_REQUIRED"


class TestStockRules:
    def test_insufficient_stock_rolls_everything_back(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(
                shop,
                lines=[
                    services.SaleLineInput(
                        variant=shop["variant_b"],
                        qty=Decimal("99"),
                        unit_price=Decimal("500"),
                        discount=Decimal("0"),
                    )
                ],
                # Paid in full (99×500 − 100 bill discount) so the credit
                # check (which runs before stock) doesn't mask the failure.
                payments=[{"method": "CASH", "amount": Decimal("49400.00")}],
            )
        assert exc.value.code == "STOCK_INSUFFICIENT"
        # Nothing was written: no invoice, no movement, number not burned.
        assert SalesInvoice.objects.filter(tenant=shop["tenant"]).count() == 0
        assert StockMovement.objects.filter(type=StockMovement.MovementType.SALE).count() == 0
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_b"])
        assert level.qty_on_hand == Decimal("5")
        result = _sale(shop, idempotency_key="key-after")
        assert result.invoice.invoice_no == 1  # failed sale left no gap

    def test_zero_qty_line_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(
                shop,
                lines=[
                    services.SaleLineInput(
                        variant=shop["variant_a"],
                        qty=Decimal("0"),
                        unit_price=None,
                        discount=Decimal("0"),
                    )
                ],
            )
        assert exc.value.code == "QTY_INVALID"


class TestCreditRules:
    def test_due_requires_customer(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, customer=None)
        assert exc.value.code == "UDHARO_REQUIRES_CUSTOMER"

    def test_fully_paid_sale_needs_no_customer(self, shop: dict) -> None:
        result = _sale(
            shop, customer=None, payments=[{"method": "CASH", "amount": Decimal("2547.00")}]
        )
        assert result.invoice.due_amount == Decimal("0")

    def test_credit_limit_exceeded(self, shop: dict) -> None:
        shop["customer"].credit_limit = Decimal("500.00")
        shop["customer"].save()
        with pytest.raises(ServiceError) as exc:
            _sale(shop)
        assert exc.value.code == "CREDIT_LIMIT_EXCEEDED"

    def test_existing_dues_count_toward_limit(self, shop: dict) -> None:
        _sale(shop)  # due 547
        shop["customer"].credit_limit = Decimal("1000.00")
        shop["customer"].save()
        with pytest.raises(ServiceError) as exc:
            _sale(shop, idempotency_key="key-3")  # would push dues to 1094
        assert exc.value.code == "CREDIT_LIMIT_EXCEEDED"

    def test_no_limit_means_unlimited(self, shop: dict) -> None:
        shop["customer"].credit_limit = None
        shop["customer"].save()
        result = _sale(shop)
        assert result.invoice.due_amount == Decimal("547.00")


class TestPaymentRules:
    def test_overpayment_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, payments=[{"method": "CASH", "amount": Decimal("9999.00")}])
        assert exc.value.code == "OVERPAYMENT"

    def test_unknown_method_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, payments=[{"method": "BITCOIN", "amount": Decimal("10.00")}])
        assert exc.value.code == "PAYMENT_METHOD_INVALID"

    def test_non_positive_amount_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, payments=[{"method": "CASH", "amount": Decimal("0")}])
        assert exc.value.code == "PAYMENT_AMOUNT_INVALID"

    def test_credit_method_is_due_not_paid(self, shop: dict) -> None:
        result = _sale(
            shop,
            payments=[
                {"method": "CASH", "amount": Decimal("2000.00")},
                {"method": "CREDIT", "amount": Decimal("547.00")},
            ],
        )
        assert result.invoice.paid_amount == Decimal("2000.00")
        assert result.invoice.due_amount == Decimal("547.00")


class TestGuardrailsAndDiscounts:
    def test_explicit_price_below_min_rejected(self, shop: dict) -> None:
        shop["variant_a"].min_selling_price = Decimal("900.00")
        shop["variant_a"].save()
        with pytest.raises(ServiceError) as exc:
            _sale(
                shop,
                lines=[
                    services.SaleLineInput(
                        variant=shop["variant_a"],
                        qty=Decimal("1"),
                        unit_price=Decimal("800.00"),
                        discount=Decimal("0"),
                    )
                ],
            )
        assert exc.value.code == "PRICE_BELOW_MIN"
        assert "cost" not in exc.value.message.lower()

    def test_discount_above_line_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(
                shop,
                lines=[
                    services.SaleLineInput(
                        variant=shop["variant_a"],
                        qty=Decimal("1"),
                        unit_price=Decimal("100.00"),
                        discount=Decimal("200.00"),
                    )
                ],
            )
        assert exc.value.code == "DISCOUNT_INVALID"

    def test_bill_discount_above_subtotal_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _sale(shop, bill_discount=Decimal("99999.00"))
        assert exc.value.code == "DISCOUNT_INVALID"


class TestCostSnapshot:
    def test_later_cost_change_never_rewrites_history(self, shop: dict) -> None:
        result = _sale(shop)
        line = SalesInvoiceItem.objects.get(invoice=result.invoice, variant=shop["variant_a"])
        assert line.cost_at_sale == Decimal("600.00")

        # New stock at a higher cost moves the average; the old line keeps 600.
        post_opening_stock(
            shop["tenant"],
            branch=shop["branch"],
            variant=shop["variant_a"],
            qty=Decimal("10"),
            unit_cost=Decimal("900.00"),
            created_by=shop["user"],
        )
        shop["variant_a"].refresh_from_db()
        assert shop["variant_a"].avg_cost != Decimal("600.00")
        line.refresh_from_db()
        assert line.cost_at_sale == Decimal("600.00")


class TestHeldBills:
    def test_hold_takes_no_stock_and_no_number(self, shop: dict) -> None:
        result = services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            customer=shop["customer"],
            lines=[
                services.SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("2"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="hold-1",
            created_by=shop["user"],
        )
        invoice = result.invoice
        assert invoice.status == SalesInvoice.Status.HELD
        assert invoice.invoice_no is None
        assert invoice.total == Decimal("2000.00")  # display total
        assert StockMovement.objects.filter(type=StockMovement.MovementType.SALE).count() == 0
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level.qty_on_hand == Decimal("10")

    def test_hold_replay_returns_original(self, shop: dict) -> None:
        kw: dict[str, Any] = {
            "branch": shop["branch"],
            "rate_type": shop["rate_type"],
            "lines": [
                services.SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            "idempotency_key": "hold-replay",
            "created_by": shop["user"],
        }
        first = services.hold_bill(shop["tenant"], **kw)
        second = services.hold_bill(shop["tenant"], **kw)
        assert second.replayed is True
        assert second.invoice.pk == first.invoice.pk

    def test_complete_held_bill_full_pipeline(self, shop: dict) -> None:
        held = services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            customer=shop["customer"],
            lines=[
                services.SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("2"),
                    unit_price=None,
                    discount=Decimal("100"),
                )
            ],
            idempotency_key="hold-2",
            created_by=shop["user"],
        ).invoice
        completed = services.complete_held_bill(
            shop["tenant"],
            invoice=held,
            payments=[{"method": "CASH", "amount": Decimal("1900.00")}],
            created_by=shop["user"],
        )
        assert completed.status == SalesInvoice.Status.COMPLETED
        assert completed.invoice_no == 1
        assert completed.total == Decimal("1900.00")
        assert completed.due_amount == Decimal("0")
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level.qty_on_hand == Decimal("8")
        item = SalesInvoiceItem.objects.get(invoice=completed)
        assert item.cost_at_sale == Decimal("600.00")  # re-snapshotted at completion

    def test_cancel_held_bill(self, shop: dict) -> None:
        held = services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            lines=[
                services.SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="hold-3",
            created_by=shop["user"],
        ).invoice
        cancelled = services.cancel_held_bill(shop["tenant"], invoice=held)
        assert cancelled.status == SalesInvoice.Status.CANCELLED
        # Nothing consumed: stock untouched, no number burned.
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level.qty_on_hand == Decimal("10")

    def test_complete_empty_held_bill_rejected(self, shop: dict) -> None:
        held = services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            lines=[
                services.SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="hold-4",
            created_by=shop["user"],
        ).invoice
        held.items.all().delete()
        with pytest.raises(ServiceError) as exc:
            services.complete_held_bill(
                shop["tenant"], invoice=held, payments=[], created_by=shop["user"]
            )
        assert exc.value.code == "LINES_REQUIRED"

    def test_hold_missing_key_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.hold_bill(
                shop["tenant"],
                branch=shop["branch"],
                rate_type=shop["rate_type"],
                lines=[],
                idempotency_key="",
                created_by=shop["user"],
            )
        assert exc.value.code == "IDEMPOTENCY_KEY_REQUIRED"


class TestCompletedImmutability:
    def test_completed_cannot_be_completed_again(self, shop: dict) -> None:
        invoice = _sale(shop).invoice
        with pytest.raises(ServiceError) as exc:
            services.complete_held_bill(
                shop["tenant"], invoice=invoice, payments=[], created_by=shop["user"]
            )
        assert exc.value.code == "INVOICE_NOT_EDITABLE"
        assert exc.value.http_status == 409

    def test_completed_cannot_be_cancelled(self, shop: dict) -> None:
        invoice = _sale(shop).invoice
        with pytest.raises(ServiceError) as exc:
            services.cancel_held_bill(shop["tenant"], invoice=invoice)
        assert exc.value.code == "INVOICE_NOT_EDITABLE"

    def test_cancelled_cannot_be_completed(self, shop: dict) -> None:
        held = services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            lines=[
                services.SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="hold-5",
            created_by=shop["user"],
        ).invoice
        services.cancel_held_bill(shop["tenant"], invoice=held)
        with pytest.raises(ServiceError) as exc:
            services.complete_held_bill(
                shop["tenant"], invoice=held, payments=[], created_by=shop["user"]
            )
        assert exc.value.code == "INVOICE_NOT_EDITABLE"


class TestBusinessDates:
    def test_explicit_business_date_denormalized(self, shop: dict) -> None:
        """Golden-fixture pair: AD 2000-01-01 = BS 2056-09-17, FY 2056-57."""
        result = _sale(shop, business_date=date(2000, 1, 1))
        invoice = result.invoice
        assert invoice.business_date_bs == "2056-09-17"
        assert invoice.fiscal_year_bs == "2056-57"
        # Numbering is per fiscal year: first bill of 2056-57 is 1.
        assert invoice.invoice_no == 1
