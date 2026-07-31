"""Purchasing service tests — totals/VAT, landed allocation, confirm pipeline.

Reference bill (the ``shop`` fixture): tenant VAT-registered, is_vat_bill,
lines 2×A @100 (VAT-able, 10 discount) + 1×B @150, other_charges 50 →
subtotal 350, discount 10, taxable 340, VAT 13% of 190 = 24.70,
total 414.70.
"""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.models import StockBatch, StockLevel, StockMovement
from apps.inventory.services import post_opening_stock
from apps.purchasing import services
from apps.purchasing.models import PurchaseInvoice
from core.responses import ServiceError
from tests.factories import (
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    SupplierFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory(vat_registered=True)
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant, invoice_prefix="PUR")
    supplier = SupplierFactory(tenant=tenant)
    item_a = ItemFactory(tenant=tenant, is_vat_applicable=True)
    variant_a = ItemVariantFactory(tenant=tenant, item=item_a)
    variant_b = ItemVariantFactory(tenant=tenant, item=ItemFactory(tenant=tenant))
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "supplier": supplier,
        "variant_a": variant_a,
        "variant_b": variant_b,
    }


def _create(shop: dict, **overrides: Any) -> Any:
    kwargs: dict[str, Any] = {
        "branch": shop["branch"],
        "supplier": shop["supplier"],
        "bill_date_ad": date(2026, 1, 15),
        "is_vat_bill": True,
        "other_charges": Decimal("50.00"),
        "paid_amount": Decimal("100.00"),
        "note": "First batch",
        "lines": [
            {
                "variant": shop["variant_a"],
                "qty": Decimal("2"),
                "unit_cost": Decimal("100.00"),
                "discount": Decimal("10.00"),
            },
            {
                "variant": shop["variant_b"],
                "qty": Decimal("1"),
                "unit_cost": Decimal("150.00"),
                "discount": Decimal("0"),
            },
        ],
        "created_by": shop["user"],
    }
    kwargs.update(overrides)
    return services.create_purchase_invoice(shop["tenant"], **kwargs)


class TestTotals:
    def test_draft_totals_with_vat_and_charges(self, shop: dict) -> None:
        invoice = _create(shop)
        assert invoice.status == PurchaseInvoice.Status.DRAFT
        assert invoice.invoice_no is None
        assert invoice.subtotal == Decimal("350.00")
        assert invoice.discount == Decimal("10.00")
        assert invoice.taxable_amount == Decimal("340.00")
        assert invoice.vat_amount == Decimal("24.70")
        assert invoice.total == Decimal("414.70")
        assert invoice.due_amount == Decimal("314.70")  # total − paid 100
        assert invoice.bill_date_bs  # denormalized

    def test_vat_zero_when_tenant_not_registered(self, shop: dict) -> None:
        shop["tenant"].vat_registered = False
        shop["tenant"].save()
        invoice = _create(shop)
        assert invoice.vat_amount == Decimal("0")
        assert invoice.total == Decimal("390.00")

    def test_vat_zero_when_not_vat_bill(self, shop: dict) -> None:
        invoice = _create(shop, is_vat_bill=False)
        assert invoice.vat_amount == Decimal("0")


class TestLandedAllocation:
    def test_proportional_split_sums_exactly(self) -> None:
        allocated = services.allocate_landed_cost(
            [Decimal("200.00"), Decimal("150.00")], Decimal("50.00")
        )
        assert allocated == [Decimal("28.57"), Decimal("21.43")]
        assert sum(allocated) == Decimal("50.00")

    def test_largest_remainder_gives_extra_paisa_to_biggest_fraction(self) -> None:
        allocated = services.allocate_landed_cost(
            [Decimal("100.00"), Decimal("100.00"), Decimal("100.00")], Decimal("100.00")
        )
        assert sorted(allocated) == [Decimal("33.33"), Decimal("33.33"), Decimal("33.34")]
        assert sum(allocated) == Decimal("100.00")

    def test_zero_charges_and_empty_lines(self) -> None:
        assert services.allocate_landed_cost([Decimal("5.00")], Decimal("0")) == [Decimal("0")]
        assert services.allocate_landed_cost([], Decimal("10.00")) == []
        assert services.allocate_landed_cost([Decimal("0")], Decimal("10.00")) == [Decimal("0")]


class TestConfirmPipeline:
    def test_confirm_posts_movements_batches_and_number(self, shop: dict) -> None:
        post_opening_stock(
            shop["tenant"],
            branch=shop["branch"],
            variant=shop["variant_a"],
            qty=Decimal("10"),
            unit_cost=Decimal("100.00"),
            created_by=shop["user"],
        )
        invoice = _create(shop)
        confirmed = services.confirm_purchase_invoice(
            shop["tenant"], invoice=invoice, created_by=shop["user"]
        )
        assert confirmed.status == PurchaseInvoice.Status.CONFIRMED
        assert confirmed.invoice_no == 1  # first in the PURCHASE series

        # Landed cost: net A = 190, net B = 150 → charges split 27.94/22.06.
        # Landed unit A = (190 + 27.94)/2 = 108.97, B = 172.06.
        movements = {
            m.variant_id: m
            for m in StockMovement.objects.filter(type=StockMovement.MovementType.PURCHASE)
        }
        assert movements[shop["variant_a"].pk].unit_cost == Decimal("108.97")
        assert movements[shop["variant_b"].pk].unit_cost == Decimal("172.06")
        assert movements[shop["variant_a"].pk].ref_type == "purchase_invoice"

        # Weighted average folds in landed cost: (10×100 + 2×108.97)/12 = 101.50.
        level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level.qty_on_hand == Decimal("12")
        assert level.avg_cost == Decimal("101.50")
        shop["variant_a"].refresh_from_db()
        assert shop["variant_a"].avg_cost == Decimal("101.50")

        # StockBatch rows carry the landed cost.
        batches = StockBatch.objects.filter(tenant=shop["tenant"])
        assert batches.count() == 2
        batch_a = batches.get(variant=shop["variant_a"])
        assert batch_a.qty_in == Decimal("2")
        assert batch_a.qty_remaining == Decimal("2")
        assert batch_a.unit_cost == Decimal("100.00")
        assert batch_a.landed_cost == Decimal("108.97")

    def test_double_confirm_rejected(self, shop: dict) -> None:
        invoice = _create(shop)
        services.confirm_purchase_invoice(shop["tenant"], invoice=invoice, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            services.confirm_purchase_invoice(
                shop["tenant"], invoice=invoice, created_by=shop["user"]
            )
        assert exc.value.code == "INVOICE_NOT_EDITABLE"
        assert exc.value.http_status == 409

    def test_confirm_empty_invoice_rejected(self, shop: dict) -> None:
        invoice = _create(shop)
        invoice.items.all().delete()
        with pytest.raises(ServiceError) as exc:
            services.confirm_purchase_invoice(
                shop["tenant"], invoice=invoice, created_by=shop["user"]
            )
        assert exc.value.code == "LINES_REQUIRED"


class TestDraftRules:
    def test_draft_edit_replaces_lines_and_recomputes(self, shop: dict) -> None:
        invoice = _create(shop)
        updated = services.update_purchase_invoice(
            shop["tenant"],
            invoice=invoice,
            fields={"other_charges": Decimal("0")},
            lines=[
                {
                    "variant": shop["variant_b"],
                    "qty": Decimal("3"),
                    "unit_cost": Decimal("150.00"),
                    "discount": Decimal("0"),
                }
            ],
        )
        assert updated.items.count() == 1
        assert updated.subtotal == Decimal("450.00")
        assert updated.total == Decimal("450.00")  # B is not VAT-applicable

    def test_confirmed_is_terminal_for_edits(self, shop: dict) -> None:
        invoice = _create(shop)
        services.confirm_purchase_invoice(shop["tenant"], invoice=invoice, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            services.update_purchase_invoice(shop["tenant"], invoice=invoice, fields={})
        assert exc.value.code == "INVOICE_NOT_EDITABLE"

    def test_cancel_only_from_draft(self, shop: dict) -> None:
        invoice = _create(shop)
        cancelled = services.cancel_purchase_invoice(shop["tenant"], invoice=invoice)
        assert cancelled.status == PurchaseInvoice.Status.CANCELLED

        confirmed = services.confirm_purchase_invoice(
            shop["tenant"], invoice=_create(shop), created_by=shop["user"]
        )
        with pytest.raises(ServiceError) as exc:
            services.cancel_purchase_invoice(shop["tenant"], invoice=confirmed)
        assert exc.value.code == "INVOICE_NOT_EDITABLE"

    def test_line_validation(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _create(shop, lines=[])
        assert exc.value.code == "LINES_REQUIRED"
        with pytest.raises(ServiceError) as exc:
            _create(
                shop,
                lines=[
                    {
                        "variant": shop["variant_a"],
                        "qty": Decimal("0"),
                        "unit_cost": Decimal("10.00"),
                        "discount": Decimal("0"),
                    }
                ],
            )
        assert exc.value.code == "QTY_INVALID"
        with pytest.raises(ServiceError) as exc:
            _create(
                shop,
                lines=[
                    {
                        "variant": shop["variant_a"],
                        "qty": Decimal("1"),
                        "unit_cost": Decimal("-5.00"),
                        "discount": Decimal("0"),
                    }
                ],
            )
        assert exc.value.code == "COST_INVALID"


class TestNumbering:
    def test_purchase_series_independent_of_sales(self, shop: dict) -> None:
        first = services.confirm_purchase_invoice(
            shop["tenant"], invoice=_create(shop), created_by=shop["user"]
        )
        second = services.confirm_purchase_invoice(
            shop["tenant"], invoice=_create(shop), created_by=shop["user"]
        )
        assert (first.invoice_no, second.invoice_no) == (1, 2)
