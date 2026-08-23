"""API tests for reports endpoints — auth, permissions, params, shape."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from core.calendar.bs import ad_to_bs
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    CustomerFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG, vat_registered=True)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def shop(tenant: Any, user: Any) -> dict[str, Any]:
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    from tests.factories import ItemFactory

    item = ItemFactory(tenant=tenant, is_vat_applicable=True)
    variant = ItemVariantFactory(tenant=tenant, item=item, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("20"),
        unit_cost=Decimal("600.00"),
        created_by=user,
    )
    customer = CustomerFactory(tenant=tenant, credit_limit=None)
    sale = sale_services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(variant=variant, qty=Decimal("2"), unit_price=None, discount=Decimal("0"))
        ],
        payments=[{"method": "CASH", "amount": Decimal("2260.00")}],
        is_vat_bill=True,
        idempotency_key="s1",
        created_by=user,
        business_date=date.today(),
    ).invoice
    return {"branch": branch, "variant": variant, "customer": customer, "sale": sale}


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str = SLUG) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **host(slug),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


def _today_range() -> dict[str, str]:
    today = date.today()
    return {
        "date_from_bs": ad_to_bs(today - timedelta(days=3)),
        "date_to_bs": ad_to_bs(today + timedelta(days=3)),
    }


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get("/api/v1/reports/daily-sales", **host()).status_code == 401

    def test_missing_report_sales_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        response = auth_client(user).get("/api/v1/reports/daily-sales", **host())
        assert response.status_code == 403

    def test_stock_report_requires_report_stock(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "report.sales")
        response = auth_client(user).get("/api/v1/reports/stock-summary", **host())
        assert response.status_code == 403


class TestSalesReportsApi:
    def test_daily_sales_happy(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.sales")
        response = auth_client(user).get("/api/v1/reports/daily-sales", _today_range(), **host())
        assert response.status_code == 200
        rows = response.json()["data"]
        assert len(rows) == 1
        assert rows[0]["total"] == "2260.00"

    def test_monthly_sales_happy(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.sales")
        response = auth_client(user).get("/api/v1/reports/monthly-sales", **host())
        assert response.status_code == 200
        assert response.json()["data"][0]["total"] == "2260.00"

    def test_item_sales_happy(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.sales")
        response = auth_client(user).get("/api/v1/reports/item-sales", _today_range(), **host())
        assert response.status_code == 200
        assert response.json()["data"][0]["qty"] == "2.000"
        assert response.json()["meta"]["count"] == 1

    def test_invalid_bs_date_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "report.sales")
        response = auth_client(user).get(
            "/api/v1/reports/daily-sales",
            {"date_from_bs": "2026-01-01", "date_to_bs": "2082-13-99"},
            **host(),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_INVALID"

    def test_incomplete_range_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "report.sales")
        response = auth_client(user).get(
            "/api/v1/reports/daily-sales", {"date_from_bs": "2082-04-01"}, **host()
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_RANGE_INCOMPLETE"


class TestDashboardApi:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        response = APIClient().get("/api/v1/dashboard", **host())
        assert response.status_code == 401

    def test_cashier_gets_only_operational_tiles(self, tenant: Any, user: Any, shop: dict) -> None:
        item = shop["variant"].item
        item.reorder_level = Decimal("25")
        item.save(update_fields=["reorder_level"])
        grant(tenant, user, "sale.create", "sale.view", "stock.view")

        response = auth_client(user).get("/api/v1/dashboard", **host())

        assert response.status_code == 200
        data = response.json()["data"]
        # Collection aggregates are owner-level: no report.sales, no totals.
        assert "today_total" not in data["sales"]
        assert "last_30_days" not in data["sales"]
        assert "month_to_date_total" not in data["sales"]
        # Operational bits stay: the staff's own bill count and bills.
        assert data["sales"]["bill_count"] == 1
        assert data["low_stock"]["count"] == 1
        assert data["recent_bills"][0]["invoice_no"] == shop["sale"].invoice_no
        assert "profit" not in data
        assert "dues" not in data

    def test_owner_gets_profit_and_dues_tiles(self, tenant: Any, user: Any, shop: dict) -> None:
        tenant.plan.features = {**tenant.plan.features, "profit_reports": True}
        tenant.plan.save(update_fields=["features"])
        grant(
            tenant,
            user,
            "pricing.view_cost",
            "report.ledger",
            "report.profit",
            "report.sales",
            "sale.view",
            "stock.view",
        )

        response = auth_client(user).get("/api/v1/dashboard", **host())

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["sales"]["today_total"] == "2260.00"
        assert [row["net_total"] for row in data["sales"]["last_30_days"]] == ["2260.00"]
        assert data["sales"]["month_to_date_total"] == "2260.00"
        # The month window starts on the current BS month's 1st.
        expected_month_start = f"{ad_to_bs(timezone.localdate())[:7]}-01"
        assert data["sales"]["month_start_bs"] == expected_month_start
        assert data["profit"]["today_net_profit"] == "1060.00"
        assert data["dues"] == {"customer_count": 0, "total_receivable": "0.00"}


class TestProfitReportApi:
    def test_profit_requires_view_cost(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.profit")  # report.profit but NO pricing.view_cost
        response = auth_client(user).get("/api/v1/reports/profit", **host())
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "COST_VISIBILITY_REQUIRED"

    def test_profit_with_both_perms(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.profit", "pricing.view_cost")
        response = auth_client(user).get("/api/v1/reports/profit", _today_range(), **host())
        assert response.status_code == 200
        assert response.json()["data"]["totals"]["gross_profit"] == "1060.00"

    def test_profit_requires_report_profit(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "pricing.view_cost")  # cost perm but no report.profit
        response = auth_client(user).get("/api/v1/reports/profit", **host())
        assert response.status_code == 403


class TestOtherReportsApi:
    def test_dues_report(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.ledger")
        response = auth_client(user).get("/api/v1/reports/dues", **host())
        assert response.status_code == 200
        assert "receivables" in response.json()["data"]
        assert "payables" in response.json()["data"]

    def test_vat_register(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "report.vat")
        response = auth_client(user).get(
            "/api/v1/reports/vat-register/sales", _today_range(), **host()
        )
        assert response.status_code == 200
        rows = response.json()["data"]["rows"]
        assert len(rows) == 1
        assert rows[0]["vat_amount"] == "260.00"
        assert response.json()["data"]["totals"]["total"] == "2260.00"

    def test_low_stock_pagination_meta(self, tenant: Any, user: Any, shop: dict) -> None:
        from tests.factories import ItemFactory, StockLevelFactory

        item = ItemFactory(tenant=tenant, reorder_level=Decimal("25"))
        variant = ItemVariantFactory(tenant=tenant, item=item)
        StockLevelFactory(tenant=tenant, branch=shop["branch"], variant=variant, qty_on_hand="5")
        grant(tenant, user, "report.stock")
        response = auth_client(user).get("/api/v1/reports/low-stock", **host())
        assert response.status_code == 200
        assert response.json()["meta"]["count"] == 1
        assert response.json()["data"][0]["sku"] == variant.sku
