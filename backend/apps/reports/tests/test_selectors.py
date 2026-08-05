"""Reports selector tests — exact grouped numbers over a fixture graph.

The graph (built once per test via the ``graph`` fixture):
- variant A (VAT-able, MRP 1000, opening 20@600), B (MRP 500, opening
  10@300, reorder 15), C (MRP 200, opening 5@100, reorder 3, never sold)
- sale1: AD 2025-07-20, 2×A VAT bill, cash 1500 (due 760)
- return on sale1: AD 2025-07-25, 1×A (CREDIT_NOTE 300 + CASH 700)
- sale2: AD 2025-08-20, 1×B cash 500
- sale3: AD 2025-04-20 (FY 2081-82), 1×A cash 1000
- receipt: 400 from the customer
- purchase: VAT bill 5×A @700 confirmed, supplier PAN 600111222
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from apps.purchasing import services as purchase_services
from apps.reports import selectors
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from core.calendar.bs import ad_to_bs
from tests.factories import (
    BranchFactory,
    CustomerFactory,
    ItemFactory,
    ItemVariantFactory,
    RateTypeFactory,
    SupplierFactory,
    TenantFactory,
    UserFactory,
)
from tests.factories.accounts import RoleFactory, RolePermissionFactory, UserRoleFactory

pytestmark = pytest.mark.django_db

D_SALE1 = date(2025, 7, 20)
D_RETURN = date(2025, 7, 25)
D_SALE2 = date(2025, 8, 20)
D_SALE3 = date(2025, 4, 20)
D_PURCHASE = date(2025, 7, 22)


def _grant(user: Any, tenant: Any, *codes: str) -> Any:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)
    return user


@pytest.fixture
def graph() -> dict[str, Any]:
    tenant = TenantFactory(vat_registered=True)
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    customer = CustomerFactory(tenant=tenant, credit_limit=None)
    supplier = SupplierFactory(tenant=tenant, pan_no="600111222")

    item_a = ItemFactory(tenant=tenant, is_vat_applicable=True)
    variant_a = ItemVariantFactory(tenant=tenant, item=item_a, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_a,
        qty=Decimal("20"),
        unit_cost=Decimal("600.00"),
        created_by=user,
    )

    item_b = ItemFactory(tenant=tenant, reorder_level=Decimal("15"))
    variant_b = ItemVariantFactory(tenant=tenant, item=item_b, mrp=Decimal("500.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_b,
        qty=Decimal("10"),
        unit_cost=Decimal("300.00"),
        created_by=user,
    )

    item_c = ItemFactory(tenant=tenant, reorder_level=Decimal("3"))
    variant_c = ItemVariantFactory(tenant=tenant, item=item_c, mrp=Decimal("200.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_c,
        qty=Decimal("5"),
        unit_cost=Decimal("100.00"),
        created_by=user,
    )

    sale1 = sale_services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(
                variant=variant_a, qty=Decimal("2"), unit_price=None, discount=Decimal("0")
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("1500.00")}],
        is_vat_bill=True,
        idempotency_key="s1",
        created_by=user,
        business_date=D_SALE1,
    ).invoice

    sale_services.create_return(
        tenant,
        original_invoice=sale1,
        lines=[sale_services.ReturnLineInput(variant=variant_a, qty=Decimal("1"))],
        reason="Wrong size",
        refunds=[
            {"method": "CREDIT_NOTE", "amount": Decimal("300.00")},
            {"method": "CASH", "amount": Decimal("700.00")},
        ],
        idempotency_key="r1",
        created_by=user,
        business_date=D_RETURN,
    )

    sale2 = sale_services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(
                variant=variant_b, qty=Decimal("1"), unit_price=None, discount=Decimal("0")
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("500.00")}],
        idempotency_key="s2",
        created_by=user,
        business_date=D_SALE2,
    ).invoice

    sale_services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(
                variant=variant_a, qty=Decimal("1"), unit_price=None, discount=Decimal("0")
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("1000.00")}],
        idempotency_key="s3",
        created_by=user,
        business_date=D_SALE3,
    )

    from apps.payments import services as payment_services

    payment_services.record_receipt(
        tenant,
        branch=branch,
        customer=customer,
        amount=Decimal("400.00"),
        method="CASH",
        idempotency_key="rcpt1",
        created_by=user,
    )

    purchase = purchase_services.create_purchase_invoice(
        tenant,
        branch=branch,
        supplier=supplier,
        bill_date_ad=D_PURCHASE,
        is_vat_bill=True,
        other_charges=Decimal("0"),
        paid_amount=Decimal("0"),
        note="",
        created_by=user,
        lines=[
            {
                "variant": variant_a,
                "qty": Decimal("5"),
                "unit_cost": Decimal("700.00"),
                "discount": Decimal("0"),
            }
        ],
    )
    purchase_services.confirm_purchase_invoice(tenant, invoice=purchase, created_by=user)

    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "customer": customer,
        "supplier": supplier,
        "variant_a": variant_a,
        "variant_b": variant_b,
        "variant_c": variant_c,
        "sale1": sale1,
        "sale2": sale2,
    }


def _range(g: dict, start: date = D_SALE1, end: date = D_SALE2) -> tuple[str, str]:
    return ad_to_bs(start - timedelta(days=5)), ad_to_bs(end + timedelta(days=5))


class TestDailySales:
    def test_exact_daily_rows(self, graph: dict) -> None:
        from_bs, to_bs = _range(graph)
        rows = selectors.daily_sales(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        by_date = {row["business_date_bs"]: row for row in rows}

        day1 = by_date[ad_to_bs(D_SALE1)]
        assert day1["bill_count"] == 1
        assert day1["subtotal"] == "2000.00"
        assert day1["vat"] == "260.00"
        assert day1["total"] == "2260.00"
        assert day1["paid"] == "1500.00"
        assert day1["due"] == "760.00"
        assert day1["returns_total"] == "0"

        return_day = by_date[ad_to_bs(D_RETURN)]
        assert return_day["bill_count"] == 0
        assert return_day["returns_count"] == 1
        assert return_day["returns_total"] == "1130.00"
        assert return_day["net_total"] == "-1130.00"

        day2 = by_date[ad_to_bs(D_SALE2)]
        assert day2["bill_count"] == 1
        assert day2["total"] == "500.00"

    def test_empty_period_returns_empty(self, graph: dict) -> None:
        rows = selectors.daily_sales(
            graph["tenant"],
            graph["user"],
            date_from_bs="2080-01-01",
            date_to_bs="2080-01-31",
        )
        assert rows == []


class TestMonthlySales:
    def test_bs_month_grouping_across_fy_boundary(self, graph: dict) -> None:
        rows = selectors.monthly_sales(graph["tenant"], graph["user"])
        by_month = {row["bs_month"]: row for row in rows}

        sale3_month = ad_to_bs(D_SALE3)[:7]
        assert by_month[sale3_month]["bill_count"] == 1
        assert by_month[sale3_month]["total"] == "1000.00"

        sale1_month = ad_to_bs(D_SALE1)[:7]
        assert by_month[sale1_month]["bill_count"] == 1
        assert by_month[sale1_month]["total"] == "2260.00"
        assert by_month[sale1_month]["returns_total"] == "1130.00"
        assert by_month[sale1_month]["net_total"] == "1130.00"

        assert by_month[ad_to_bs(D_SALE2)[:7]]["total"] == "500.00"

    def test_fiscal_year_filter(self, graph: dict) -> None:
        rows = selectors.monthly_sales(graph["tenant"], graph["user"], fiscal_year_bs="2082-83")
        months = {row["bs_month"] for row in rows}
        assert ad_to_bs(D_SALE3)[:7] not in months  # 2081-82 excluded
        assert ad_to_bs(D_SALE1)[:7] in months


class TestItemSales:
    def test_top_variants_by_qty(self, graph: dict) -> None:
        from_bs, to_bs = _range(graph)
        rows = selectors.item_sales(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        assert [row["sku"] for row in rows] == [
            graph["variant_a"].sku,
            graph["variant_b"].sku,
        ]
        assert rows[0]["qty"] == "2.000"
        assert rows[0]["amount"] == "2000.00"
        assert rows[1]["qty"] == "1.000"


class TestStockReports:
    def test_stock_summary_with_cost(self, graph: dict) -> None:
        _grant(graph["user"], graph["tenant"], "pricing.view_cost")
        rows = selectors.stock_summary(graph["tenant"], graph["user"])
        by_sku = {row["sku"]: row for row in rows}

        row_a = by_sku[graph["variant_a"].sku]
        # A: 20 − 1 (sale3) − 2 (sale1) + 1 (return) + 5 (purchase) = 23.
        # avg after purchase = (18×600 + 5×700) / 23 = 621.74.
        assert row_a["qty_on_hand"] == "23.000"
        assert row_a["avg_cost"] == "621.74"
        assert row_a["cost_valuation"] == "14300.02"
        assert row_a["mrp_valuation"] == "23000.00"

        row_b = by_sku[graph["variant_b"].sku]
        assert row_b["qty_on_hand"] == "9.000"
        assert row_b["avg_cost"] == "300.00"

    def test_stock_summary_drops_cost_without_permission(self, graph: dict) -> None:
        rows = selectors.stock_summary(graph["tenant"], graph["user"])
        for row in rows:
            assert "avg_cost" not in row
            assert "cost_valuation" not in row
            assert "mrp_valuation" in row  # MRP is not cost data

    def test_low_stock(self, graph: dict) -> None:
        rows = selectors.low_stock(graph["tenant"], graph["user"])
        skus = {row["sku"] for row in rows}
        assert graph["variant_b"].sku in skus  # 9 ≤ reorder 15
        assert graph["variant_c"].sku not in skus  # 5 > reorder 3
        assert graph["variant_a"].sku not in skus  # no reorder level

    def test_dead_stock(self, graph: dict) -> None:
        # The graph's sales are in 2025 — outside the 90-day window — so
        # give A one sale TODAY: A is alive, B and C stay dead.
        sale_services.create_sale(
            graph["tenant"],
            branch=graph["branch"],
            rate_type=graph["rate_type"],
            customer=graph["customer"],
            lines=[
                SaleLineInput(
                    variant=graph["variant_a"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            payments=[{"method": "CASH", "amount": Decimal("1000.00")}],
            idempotency_key="s-recent",
            created_by=graph["user"],
            business_date=date.today(),
        )
        rows = selectors.dead_stock(graph["tenant"], graph["user"])
        skus = {row["sku"] for row in rows}
        assert graph["variant_c"].sku in skus  # never sold
        assert graph["variant_b"].sku in skus  # only sold back in 2025
        assert graph["variant_a"].sku not in skus

    def test_dead_stock_boundary(self, graph: dict) -> None:
        """A sale of C 89 days ago clears dead stock; 91 days ago doesn't."""
        from apps.inventory.models import StockMovement

        sale = sale_services.create_sale(
            graph["tenant"],
            branch=graph["branch"],
            rate_type=graph["rate_type"],
            customer=graph["customer"],
            lines=[
                SaleLineInput(
                    variant=graph["variant_c"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            payments=[{"method": "CASH", "amount": Decimal("200.00")}],
            idempotency_key="sc",
            created_by=graph["user"],
            business_date=date.today() - timedelta(days=89),
        ).invoice
        skus = {row["sku"] for row in selectors.dead_stock(graph["tenant"], graph["user"])}
        assert graph["variant_c"].sku not in skus

        StockMovement.objects.filter(ref_id=sale.pk).update(
            business_date_ad=date.today() - timedelta(days=91)
        )
        skus = {row["sku"] for row in selectors.dead_stock(graph["tenant"], graph["user"])}
        assert graph["variant_c"].sku in skus


class TestProfitReport:
    def test_profit_uses_snapshot_not_current_cost(self, graph: dict) -> None:
        from_bs, to_bs = _range(graph)
        before = selectors.profit_report(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        # revenue = (2260 + 500) − 1130 = 1630
        # cogs = (2−1)×600 + 1×300 = 900 → gross 730
        assert before["totals"]["revenue"] == "1630.00"
        assert before["totals"]["cogs"] == "900.00"
        assert before["totals"]["gross_profit"] == "730.00"

        # Move the average cost long after the sales; the report must not move.
        post_opening_stock(
            graph["tenant"],
            branch=graph["branch"],
            variant=graph["variant_a"],
            qty=Decimal("50"),
            unit_cost=Decimal("999.00"),
            created_by=graph["user"],
        )
        after = selectors.profit_report(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        assert after == before


class TestDuesReport:
    def test_receivables_and_payables(self, graph: dict) -> None:
        report = selectors.dues_report(graph["tenant"], graph["user"])
        receivables = report["receivables"]
        assert len(receivables) == 1
        # due 760 − credit note 300 − receipt 400 = 60 in the 0-30 bucket
        assert receivables[0]["total_outstanding"] == "60.00"

        payables = report["payables"]
        assert len(payables) == 1
        assert payables[0]["supplier_name"] == graph["supplier"].name
        assert payables[0]["payable"] == "3955.00"


class TestVatRegisters:
    def test_sales_register_rows_and_totals(self, graph: dict) -> None:
        from_bs, to_bs = _range(graph, start=D_SALE1, end=D_RETURN)
        report = selectors.sales_vat_register(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        assert len(report["rows"]) == 2  # the SALE bill + its RETURN credit note
        sale_row, return_row = report["rows"]
        assert sale_row["doc_type"] == "SALE"
        assert sale_row["taxable_amount"] == "2000.00"
        assert sale_row["vat_amount"] == "260.00"
        assert sale_row["customer_name"] == graph["customer"].name
        assert sale_row["customer_pan"] == "—"  # unset PAN falls back to dash
        assert return_row["doc_type"] == "RETURN"
        assert return_row["vat_amount"] == "130.00"
        assert report["totals"]["vat_amount"] == "390.00"

    def test_sales_register_shows_customer_pan_when_set(self, graph: dict) -> None:
        graph["customer"].pan = "600999888"
        graph["customer"].save()
        from_bs, to_bs = _range(graph, start=D_SALE1, end=D_SALE1)
        report = selectors.sales_vat_register(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        assert report["rows"][0]["customer_pan"] == "600999888"

    def test_purchase_register(self, graph: dict) -> None:
        from_bs, to_bs = _range(graph, start=D_PURCHASE, end=D_PURCHASE)
        report = selectors.purchase_vat_register(
            graph["tenant"], graph["user"], date_from_bs=from_bs, date_to_bs=to_bs
        )
        assert len(report["rows"]) == 1
        row = report["rows"][0]
        assert row["supplier_pan"] == "600111222"
        assert row["taxable_amount"] == "3500.00"
        assert row["vat_amount"] == "455.00"
        assert report["totals"]["total"] == "3955.00"
