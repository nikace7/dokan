"""Tests for collections-by-tender: mixed tenders aggregate, CREDIT/POINTS
excluded (not collections), date/branch filters, permissions, empty period."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from apps.reports import selectors
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
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
URL = "/api/v1/reports/collections-by-tender"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory(slug=SLUG)
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant, code="MAIN")
    branch_b = BranchFactory(tenant=tenant, code="OUTLET")
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1000.00"))
    for b in (branch, branch_b):
        post_opening_stock(
            tenant,
            branch=b,
            variant=variant,
            qty=Decimal("100"),
            unit_cost=Decimal("500.00"),
            created_by=user,
        )
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "branch_b": branch_b,
        "rate_type": rate_type,
        "variant": variant,
        "customer": CustomerFactory(tenant=tenant, credit_limit=None),
    }


def _sale(
    shop: dict,
    tenders: list[dict[str, Any]],
    *,
    key: str,
    branch: Any = None,
    business_date: date | None = None,
) -> Any:
    return sale_services.create_sale(
        shop["tenant"],
        branch=branch or shop["branch"],
        rate_type=shop["rate_type"],
        customer=shop["customer"],
        lines=[
            SaleLineInput(
                variant=shop["variant"],
                qty=Decimal("1"),
                unit_price=None,
                discount=Decimal("0"),
            )
        ],
        payments=tenders,
        idempotency_key=key,
        created_by=shop["user"],
        business_date=business_date,
    ).invoice


def _today_range() -> dict[str, str]:
    from core.calendar.bs import ad_to_bs

    today = date.today()
    return {"date_from_bs": ad_to_bs(today), "date_to_bs": ad_to_bs(today)}


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


@pytest.fixture
def mixed(shop: dict) -> dict[str, Any]:
    """Today, main branch: CASH 300 + QR 700; ESEWA 500 + CREDIT 500 (excluded).
    Outlet: CASH 200. Ten days ago: FONEPAY 1000."""
    _sale(
        shop,
        [
            {"method": "CASH", "amount": Decimal("300.00")},
            {"method": "QR", "amount": Decimal("700.00")},
        ],
        key="t-1",
    )
    _sale(
        shop,
        [
            {"method": "ESEWA", "amount": Decimal("500.00")},
            {"method": "CREDIT", "amount": Decimal("500.00")},
        ],
        key="t-2",
    )
    _sale(
        shop, [{"method": "CASH", "amount": Decimal("200.00")}], key="t-3", branch=shop["branch_b"]
    )
    _sale(
        shop,
        [{"method": "FONEPAY", "amount": Decimal("1000.00")}],
        key="t-4",
        business_date=date.today() - timedelta(days=10),
    )
    return shop


class TestSelector:
    def test_mixed_tenders_aggregate_and_credit_excluded(self, mixed: dict) -> None:
        report = selectors.collections_by_tender(mixed["tenant"], mixed["user"], **_today_range())
        by_method = {row["method"]: row for row in report["methods"]}
        assert by_method["QR"] == {"method": "QR", "amount": "700.00", "count": 1}
        assert by_method["ESEWA"]["amount"] == "500.00"
        # Tenant-wide (no branch filter) also includes the outlet's CASH 200.
        assert by_method["CASH"] == {"method": "CASH", "amount": "500.00", "count": 2}
        assert "CREDIT" not in by_method
        assert report["total"] == "1700.00"  # 500 + 700 + 500 — the 500 udharo excluded
        # Ordered by amount desc, then method.
        assert [row["method"] for row in report["methods"]] == ["QR", "CASH", "ESEWA"]

    def test_branch_filter(self, mixed: dict) -> None:
        report = selectors.collections_by_tender(
            mixed["tenant"], mixed["user"], branch_id=mixed["branch_b"].pk, **_today_range()
        )
        assert report["methods"] == [{"method": "CASH", "amount": "200.00", "count": 1}]
        assert report["total"] == "200.00"

    def test_date_range_excludes_out_of_window(self, mixed: dict) -> None:
        from core.calendar.bs import ad_to_bs

        old = date.today() - timedelta(days=10)
        report = selectors.collections_by_tender(
            mixed["tenant"],
            mixed["user"],
            date_from_bs=ad_to_bs(old),
            date_to_bs=ad_to_bs(date.today()),
        )
        by_method = {row["method"]: row for row in report["methods"]}
        assert by_method["FONEPAY"]["amount"] == "1000.00"
        assert report["total"] == "2700.00"

    def test_empty_period_returns_zeros(self, shop: dict) -> None:
        report = selectors.collections_by_tender(
            shop["tenant"],
            shop["user"],
            date_from_bs="2080-01-01",
            date_to_bs="2080-01-31",
        )
        assert report["methods"] == []
        assert report["total"] == "0.00"


class TestApi:
    def test_unauthenticated_is_401(self, shop: dict) -> None:
        assert APIClient().get(URL, **host()).status_code == 401

    def test_permission_denied_is_403(self, mixed: dict) -> None:
        grant(mixed["tenant"], mixed["user"], "catalog.view")
        assert auth_client(mixed["user"]).get(URL, _today_range(), **host()).status_code == 403

    def test_happy_path_shape(self, mixed: dict) -> None:
        grant(mixed["tenant"], mixed["user"], "report.sales")
        response = auth_client(mixed["user"]).get(URL, _today_range(), **host())
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == "1700.00"
        assert data["methods"][0] == {"method": "QR", "amount": "700.00", "count": 1}
        assert data["date_from_bs"] == _today_range()["date_from_bs"]
