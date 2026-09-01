"""Returns service tests — credit-note math and the invariant-3 contract.

Reference sale (the ``shop`` fixture): VAT bill, 2×A (MRP 1000, VAT-able,
100 line discount) + 1×B (explicit 500), bill discount 100, cash 2000 →
subtotal 2500, discounts 200, taxable 2300, VAT 247, total 2547, due 547.
"""

import importlib
from decimal import Decimal
from typing import Any

import pytest
from django.db import IntegrityError

from apps.customers.selectors import get_customer_outstanding
from apps.inventory.models import StockLevel, StockMovement
from apps.inventory.services import post_opening_stock
from apps.sales import services
from apps.sales.models import SalesInvoice, SalesInvoiceItem
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

returns_module = importlib.import_module("apps.sales.services.returns")


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory(vat_registered=True)
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant, invoice_prefix="INV")
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
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
                variant=variant_a, qty=Decimal("2"), unit_price=None, discount=Decimal("100")
            ),
            SaleLineInput(
                variant=variant_b,
                qty=Decimal("1"),
                unit_price=Decimal("500.00"),
                discount=Decimal("0"),
            ),
        ],
        payments=[{"method": "CASH", "amount": Decimal("2000.00")}],
        is_vat_bill=True,
        bill_discount=Decimal("100.00"),
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


def _return(shop: dict, lines: list, key: str = "ret-1", **kwargs: Any) -> Any:
    return services.create_return(
        shop["tenant"],
        original_invoice=shop["original"],
        lines=lines,
        reason=kwargs.pop("reason", "Size didn't fit"),
        idempotency_key=key,
        created_by=shop["user"],
        **kwargs,
    )


class TestReturnMath:
    def test_partial_return_amounts(self, shop: dict) -> None:
        """Return 1×A: gross 1000, line disc 50, bill share 41.30, VAT 123.50."""
        result = _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))])
        invoice = result.invoice
        assert invoice.doc_type == SalesInvoice.DocType.RETURN
        assert invoice.original_invoice_id == shop["original"].pk
        assert invoice.subtotal == Decimal("1000.00")
        assert invoice.discount_amount == Decimal("91.30")  # 50 line + 41.30 bill share
        assert invoice.taxable_amount == Decimal("908.70")
        assert invoice.vat_amount == Decimal("123.50")  # 13% of 950
        assert invoice.total == Decimal("1032.20")
        assert invoice.status == SalesInvoice.Status.COMPLETED

    def test_return_gets_own_gapless_series(self, shop: dict) -> None:
        result = _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))])
        assert result.invoice.invoice_no == 1  # first in the RETURN series
        second = _return(
            shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))], key="ret-2"
        )
        assert second.invoice.invoice_no == 2  # RETURN series advances independently

    def test_vat_zero_when_original_not_vat_bill(self, shop: dict) -> None:
        shop["original"].is_vat_bill = False
        shop["original"].save()
        result = _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))])
        assert result.invoice.vat_amount == Decimal("0")


class TestReturnGuards:
    def test_quantity_must_be_positive(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("0"))],
            )
        assert exc.value.code == "QTY_INVALID"

    def test_over_return_across_sequential_returns(self, shop: dict) -> None:
        _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("2"))])
        with pytest.raises(ServiceError) as exc:
            _return(
                shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))], key="ret-2"
            )
        assert exc.value.code == "OVER_RETURN"

    def test_variant_not_on_original_rejected(self, shop: dict) -> None:
        other = ItemVariantFactory(tenant=shop["tenant"])
        with pytest.raises(ServiceError) as exc:
            _return(shop, [ReturnLineInput(variant=other, qty=Decimal("1"))])
        assert exc.value.code == "RETURN_LINE_NOT_INVOICED"

    def test_non_completed_original_rejected(self, shop: dict) -> None:
        held = services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            lines=[
                SaleLineInput(
                    variant=shop["variant_a"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="held-1",
            created_by=shop["user"],
        ).invoice
        with pytest.raises(ServiceError) as exc:
            services.create_return(
                shop["tenant"],
                original_invoice=held,
                lines=[ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                reason="x",
                idempotency_key="ret-held",
                created_by=shop["user"],
            )
        assert exc.value.code == "RETURN_NOT_ALLOWED"
        assert exc.value.http_status == 409

    def test_reason_required(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                reason="  ",
            )
        assert exc.value.code == "REASON_REQUIRED"

    def test_missing_key_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_return(
                shop["tenant"],
                original_invoice=shop["original"],
                lines=[ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                reason="x",
                idempotency_key="",
                created_by=shop["user"],
            )
        assert exc.value.code == "IDEMPOTENCY_KEY_REQUIRED"

    def test_return_requires_at_least_one_line(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(shop, [])
        assert exc.value.code == "LINES_REQUIRED"

    def test_unrelated_integrity_error_is_not_treated_as_replay(
        self, shop: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fail_create(*args: Any, **kwargs: Any) -> None:
            raise IntegrityError("unrelated return constraint")

        monkeypatch.setattr(returns_module, "_create_return_invoice", fail_create)

        with pytest.raises(IntegrityError, match="unrelated return constraint"):
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                key="return-unrelated-integrity",
            )


class TestStockRestore:
    def test_stock_back_at_original_cost(self, shop: dict) -> None:
        _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("2"))])
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level.qty_on_hand == Decimal("10")  # sold 2, returned 2
        assert level.avg_cost == Decimal("600.00")  # average undisturbed
        movement = StockMovement.objects.get(type=StockMovement.MovementType.SALE_RETURN)
        assert movement.unit_cost == Decimal("600.00")  # original cost_at_sale
        assert movement.qty_delta == Decimal("2")

    def test_returned_qty_counter_tracks_returns(self, shop: dict) -> None:
        _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))])
        item = SalesInvoiceItem.objects.get(invoice=shop["original"], variant=shop["variant_a"])
        assert item.returned_qty == Decimal("1")


class TestIdempotency:
    def test_replay_returns_original(self, shop: dict) -> None:
        first = _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))])
        second = _return(shop, [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))])
        assert second.replayed is True
        assert second.invoice.pk == first.invoice.pk
        assert (
            StockMovement.objects.filter(type=StockMovement.MovementType.SALE_RETURN).count() == 1
        )


class TestRefunds:
    def test_refund_amount_must_be_positive(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                refunds=[{"method": "CASH", "amount": Decimal("0")}],
            )
        assert exc.value.code == "REFUND_AMOUNT_INVALID"

    def test_refund_exceeding_credit_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                refunds=[{"method": "CASH", "amount": Decimal("99999.00")}],
            )
        assert exc.value.code == "REFUND_EXCEEDS_CREDIT"

    def test_invalid_refund_method_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                refunds=[{"method": "GOLD", "amount": Decimal("10.00")}],
            )
        assert exc.value.code == "REFUND_METHOD_INVALID"

    def test_credit_note_reduces_outstanding(self, shop: dict) -> None:
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("547.00")
        result = _return(
            shop,
            [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
            refunds=[
                {"method": "CREDIT_NOTE", "amount": Decimal("500.00")},
                {"method": "CASH", "amount": Decimal("532.20")},
            ],
        )
        assert result.invoice.refunds == [
            {"method": "CREDIT_NOTE", "amount": "500.00"},
            {"method": "CASH", "amount": "532.20"},
        ]
        # Original invoice untouched (#3); outstanding is a computed view.
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("47.00")

    def test_credit_note_beyond_outstanding_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                refunds=[{"method": "CREDIT_NOTE", "amount": Decimal("999.00")}],
            )
        assert exc.value.code == "CREDIT_NOTE_EXCEEDS_DUES"

    def test_credit_note_requires_original_customer(self, shop: dict) -> None:
        shop["original"].customer = None
        with pytest.raises(ServiceError) as exc:
            _return(
                shop,
                [ReturnLineInput(variant=shop["variant_a"], qty=Decimal("1"))],
                refunds=[{"method": "CREDIT_NOTE", "amount": Decimal("1")}],
            )
        assert exc.value.code == "CREDIT_NOTE_WITHOUT_CUSTOMER"
