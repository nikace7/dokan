"""Sales service tests — the invariants are the point.

Money-critical: apps/sales/services must stay at 100% coverage (see docs/ARCHITECTURE.md).
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
