"""Exchange service tests — one transaction, two documents, one group.

The atomicity test is the point: a failure on the sale side must leave
NO return document, NO stock movement, NO consumed returned_qty.
"""

from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.models import StockLevel, StockMovement
from apps.inventory.services import post_opening_stock
from apps.sales import services
from apps.sales.models import SalesInvoice
from apps.sales.services import ReturnLineInput, SaleLineInput
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
    """Original: 2×A @ MRP 1000 fully paid (no VAT), stock A 10@600, B 5@300."""
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant_a = ItemVariantFactory(
        tenant=tenant, item=ItemFactory(tenant=tenant), mrp=Decimal("1000.00")
    )
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_a,
        qty=Decimal("10"),
        unit_cost=Decimal("600.00"),
        created_by=user,
    )
    variant_b = ItemVariantFactory(tenant=tenant, item=ItemFactory(tenant=tenant), mrp=None)
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_b,
        qty=Decimal("5"),
        unit_cost=Decimal("300.00"),
        created_by=user,
    )
    customer = CustomerFactory(tenant=tenant, credit_limit=Decimal("10000.00"))
    original = services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(
                variant=variant_a, qty=Decimal("2"), unit_price=None, discount=Decimal("0")
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("2000.00")}],
        idempotency_key="sale-1",
        created_by=user,
    ).invoice
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant_a": variant_a,
        "variant_b": variant_b,
        "customer": customer,
        "original": original,
    }


def _exchange(shop: dict, *, new_price: str, tender: str, key: str = "ex-1", **kw: Any) -> Any:
    return services.create_exchange(
        shop["tenant"],
        original_invoice=shop["original"],
        returned_lines=[ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
        new_lines=[
            SaleLineInput(
                variant=shop["variant_b"],
                qty=Decimal("1"),
                unit_price=Decimal(new_price),
                discount=Decimal("0"),
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal(tender)}] if tender != "0" else [],
        reason="Wrong size",
        idempotency_key=key,
        created_by=shop["user"],
        **kw,
    )


class TestExchangeHappyPath:
    def test_pay_difference(self, shop: dict) -> None:
        """Credit 1000, new item 1200 → customer pays 200."""
        result = _exchange(shop, new_price="1200.00", tender="200.00")
        assert result.replayed is False
        assert result.refund_amount == Decimal("0")
        sale = result.sale_invoice
        ret = result.return_invoice
        assert sale.exchange_group_id == ret.exchange_group_id
        assert sale.original_invoice_id == shop["original"].pk
        assert ret.original_invoice_id == shop["original"].pk
        assert sale.doc_type == "SALE" and ret.doc_type == "RETURN"
        # paid = 200 tender + 1000 applied credit; due 0.
        assert sale.paid_amount == Decimal("1200.00")
        assert sale.due_amount == Decimal("0")
        assert ret.refunds == [{"method": "EXCHANGE_APPLIED", "amount": "1000.00"}]

    def test_refund_difference(self, shop: dict) -> None:
        """Credit 1000, new item 600 → shop refunds 400."""
        result = _exchange(shop, new_price="600.00", tender="0")
        assert result.refund_amount == Decimal("400.00")
        assert result.sale_invoice.paid_amount == Decimal("600.00")
        assert result.sale_invoice.due_amount == Decimal("0")
        assert result.return_invoice.refunds == [
            {"method": "EXCHANGE_APPLIED", "amount": "600.00"},
            {"method": "CASH", "amount": "400.00"},
        ]

    def test_due_difference_goes_udharo(self, shop: dict) -> None:
        """Credit 1000, new item 1500, no tender → 500 on the khata."""
        result = _exchange(shop, new_price="1500.00", tender="0")
        assert result.sale_invoice.due_amount == Decimal("500.00")

    def test_stock_moves_both_directions(self, shop: dict) -> None:
        _exchange(shop, new_price="1200.00", tender="200.00")
        level_a = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        level_b = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_b"])
        assert level_a.qty_on_hand == Decimal("9")  # sold 2, returned 1
        assert level_b.qty_on_hand == Decimal("4")  # sold 1 in exchange
        types = set(StockMovement.objects.values_list("type", flat=True).distinct())
        assert {"SALE", "SALE_RETURN", "OPENING"} <= types

    def test_both_docs_gapless_in_their_own_series(self, shop: dict) -> None:
        result = _exchange(shop, new_price="1200.00", tender="200.00")
        assert result.sale_invoice.invoice_no == 2  # SALE series (original was 1)
        assert result.return_invoice.invoice_no == 1  # first in RETURN series


class TestExchangeAtomicity:
    def test_sale_side_failure_rolls_back_everything(self, shop: dict) -> None:
        """Insufficient stock for the NEW item: no return doc, no movement."""
        with pytest.raises(ServiceError) as exc:
            services.create_exchange(
                shop["tenant"],
                original_invoice=shop["original"],
                returned_lines=[ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                new_lines=[
                    SaleLineInput(
                        variant=shop["variant_b"],
                        qty=Decimal("99"),
                        unit_price=Decimal("100.00"),
                        discount=Decimal("0"),
                    )
                ],
                payments=[{"method": "CASH", "amount": Decimal("8900.00")}],
                reason="Wrong size",
                idempotency_key="ex-fail",
                created_by=shop["user"],
            )
        assert exc.value.code == "STOCK_INSUFFICIENT"
        assert SalesInvoice.objects.filter(tenant=shop["tenant"], doc_type="RETURN").count() == 0
        assert (
            StockMovement.objects.filter(type=StockMovement.MovementType.SALE_RETURN).count() == 0
        )
        level_a = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level_a.qty_on_hand == Decimal("8")  # unchanged (sold 2 of 10)
        item = shop["original"].items.get(variant=shop["variant_a"])
        assert item.returned_qty == Decimal("0")


class TestExchangeIdempotency:
    def test_replay_returns_both_originals(self, shop: dict) -> None:
        first = _exchange(shop, new_price="1200.00", tender="200.00")
        second = _exchange(shop, new_price="1200.00", tender="200.00")
        assert second.replayed is True
        assert second.sale_invoice.pk == first.sale_invoice.pk
        assert second.return_invoice.pk == first.return_invoice.pk
        assert SalesInvoice.objects.filter(tenant=shop["tenant"]).count() == 3

    def test_missing_key_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_exchange(
                shop["tenant"],
                original_invoice=shop["original"],
                returned_lines=[ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                new_lines=[
                    SaleLineInput(
                        variant=shop["variant_b"],
                        qty=Decimal("1"),
                        unit_price=Decimal("100.00"),
                        discount=Decimal("0"),
                    )
                ],
                payments=[],
                reason="x",
                idempotency_key="",
                created_by=shop["user"],
            )
        assert exc.value.code == "IDEMPOTENCY_KEY_REQUIRED"

    def test_no_new_lines_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_exchange(
                shop["tenant"],
                original_invoice=shop["original"],
                returned_lines=[ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                new_lines=[],
                payments=[],
                reason="x",
                idempotency_key="ex-nolines",
                created_by=shop["user"],
            )
        assert exc.value.code == "LINES_REQUIRED"
