"""Expenses tests — CRUD, validation, BS denorm, summary, net profit."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.expenses import services
from apps.expenses.selectors import expense_summary
from apps.inventory.services import post_opening_stock
from apps.reports.selectors import profit_report
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from core.responses import ServiceError
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
EXPENSES_URL = "/api/v1/expenses"
CATEGORIES_URL = "/api/v1/expenses/categories"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG, vat_registered=True)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def categories(tenant: Any) -> dict[str, Any]:
    return {
        "rent": services.create_category(tenant, name="Rent"),
        "salary": services.create_category(tenant, name="Salary"),
    }


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


class TestCategoryRules:
    def test_duplicate_name_friendly_error(self, tenant: Any, categories: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_category(tenant, name="Rent")
        assert exc.value.code == "ALREADY_EXISTS"

    def test_update_duplicate_name_friendly_error(self, tenant: Any, categories: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.update_category(categories["salary"], name="Rent")
        assert exc.value.code == "ALREADY_EXISTS"

    def test_deactivate_keeps_expenses(self, tenant: Any, categories: dict, user: Any) -> None:
        services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("1000.00"),
            business_date_ad=date(2026, 1, 10),
            created_by=user,
        )
        services.deactivate_category(categories["rent"])
        assert categories["rent"].expenses.count() == 1


class TestExpenseRules:
    def test_amount_must_be_positive(self, tenant: Any, categories: dict, user: Any) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_expense(
                tenant,
                category=categories["rent"],
                amount=Decimal("0"),
                business_date_ad=date(2026, 1, 10),
                created_by=user,
            )
        assert exc.value.code == "AMOUNT_INVALID"

    def test_bs_denormalization(self, tenant: Any, categories: dict, user: Any) -> None:
        """Golden-fixture pair: AD 2000-01-01 = BS 2056-09-17, FY 2056-57."""
        expense = services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("500.00"),
            business_date_ad=date(2000, 1, 1),
            created_by=user,
        )
        assert expense.business_date_bs == "2056-09-17"
        assert expense.fiscal_year_bs == "2056-57"

    def test_update_recomputes_bs_dates(self, tenant: Any, categories: dict, user: Any) -> None:
        expense = services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("500.00"),
            business_date_ad=date(2026, 1, 10),
            created_by=user,
        )
        updated = services.update_expense(tenant, expense, business_date_ad=date(2000, 1, 1))
        assert updated.business_date_bs == "2056-09-17"

    def test_update_amount_validation(self, tenant: Any, categories: dict, user: Any) -> None:
        expense = services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("500.00"),
            business_date_ad=date(2026, 1, 10),
            created_by=user,
        )
        with pytest.raises(ServiceError) as exc:
            services.update_expense(tenant, expense, amount=Decimal("0"))
        assert exc.value.code == "AMOUNT_INVALID"

    def test_delete_expense(self, tenant: Any, categories: dict, user: Any) -> None:
        from apps.expenses.models import Expense

        expense = services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("500.00"),
            business_date_ad=date(2026, 1, 10),
            created_by=user,
        )
        services.delete_expense(tenant, expense)
        assert not Expense.objects.filter(pk=expense.pk).exists()


class TestSummary:
    def test_group_by_category(self, tenant: Any, categories: dict, user: Any) -> None:
        for category, amount in (
            ("rent", "30000.00"),
            ("salary", "15000.00"),
            ("salary", "5000.00"),
        ):
            services.create_expense(
                tenant,
                category=categories[category],
                amount=Decimal(amount),
                business_date_ad=date(2026, 1, 10),
                created_by=user,
            )
        result = expense_summary(
            tenant,
            user,
            date_from_bs="2082-09-01",
            date_to_bs="2082-10-29",
            group_by="category",
        )
        assert result["groups"][0]["key"] == "Rent"
        assert result["groups"][0]["total"] == "30000.00"
        assert result["groups"][1]["total"] == "20000.00"
        assert result["total"] == "50000.00"

    def test_group_by_month_across_fy_boundary(
        self, tenant: Any, categories: dict, user: Any
    ) -> None:
        """AD 2025-04-20 is FY 2081-82 (month 2082-01); 2025-07-20 is FY 2082-83."""
        services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("10000.00"),
            business_date_ad=date(2025, 4, 20),
            created_by=user,
        )
        services.create_expense(
            tenant,
            category=categories["rent"],
            amount=Decimal("20000.00"),
            business_date_ad=date(2025, 7, 20),
            created_by=user,
        )
        result = expense_summary(
            tenant,
            user,
            date_from_bs="2081-01-01",
            date_to_bs="2083-12-30",
            group_by="month",
        )
        keys = [group["key"] for group in result["groups"]]
        assert keys == ["2082-01", "2082-04"]


class TestNetProfit:
    def test_expenses_reduce_net_not_gross(self, tenant: Any, categories: dict, user: Any) -> None:
        tenant.vat_registered = False
        tenant.save()
        branch = BranchFactory(tenant=tenant)
        rate_type = RateTypeFactory(tenant=tenant, is_default=True)
        variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1000.00"))
        post_opening_stock(
            tenant,
            branch=branch,
            variant=variant,
            qty=Decimal("10"),
            unit_cost=Decimal("600.00"),
            created_by=user,
        )
        customer = CustomerFactory(tenant=tenant)
        sale_services.create_sale(
            tenant,
            branch=branch,
            rate_type=rate_type,
            customer=customer,
            lines=[
                SaleLineInput(
                    variant=variant, qty=Decimal("2"), unit_price=None, discount=Decimal("0")
                )
            ],
            payments=[{"method": "CASH", "amount": Decimal("2000.00")}],
            idempotency_key="s1",
            created_by=user,
            business_date=date(2026, 1, 10),
        )
        services.create_expense(  # in range
            tenant,
            category=categories["rent"],
            amount=Decimal("300.00"),
            business_date_ad=date(2026, 1, 12),
            created_by=user,
        )
        services.create_expense(  # OUT of range — must not count
            tenant,
            category=categories["rent"],
            amount=Decimal("9999.00"),
            business_date_ad=date(2025, 1, 1),
            created_by=user,
        )

        from core.calendar.bs import ad_to_bs

        report = profit_report(
            tenant,
            user,
            date_from_bs=ad_to_bs(date(2026, 1, 1)),
            date_to_bs=ad_to_bs(date(2026, 1, 31)),
        )
        # gross = 2000 − 1200 = 800; net = 800 − 300 = 500
        assert report["totals"]["gross_profit"] == "800.00"
        assert report["totals"]["expenses"] == "300.00"
        assert report["totals"]["net_profit"] == "500.00"


class TestApi:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(EXPENSES_URL, **host()).status_code == 401

    def test_read_requires_expense_view(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        assert auth_client(user).get(EXPENSES_URL, **host()).status_code == 403

    def test_write_requires_expense_manage(self, tenant: Any, user: Any, categories: dict) -> None:
        grant(tenant, user, "expense.view")
        response = auth_client(user).post(
            EXPENSES_URL,
            {
                "category": str(categories["rent"].pk),
                "amount": "1000.00",
                "business_date_ad": "2026-01-10",
            },
            **host(),
            format="json",
        )
        assert response.status_code == 403

    def test_full_crud_flow(self, tenant: Any, user: Any, categories: dict) -> None:
        branch = BranchFactory(tenant=tenant)
        grant(tenant, user, "expense.view", "expense.manage")
        client = auth_client(user)

        created = client.post(
            EXPENSES_URL,
            {
                "branch": str(branch.pk),
                "category": str(categories["rent"].pk),
                "amount": "25000.00",
                "business_date_ad": "2026-01-10",
                "payee": "Landlord Dai",
                "note": "January rent",
            },
            **host(),
            format="json",
        )
        assert created.status_code == 201
        data = created.json()["data"]
        assert data["branch_code"] == branch.code
        assert data["category_name"] == "Rent"
        assert data["business_date_bs"]

        expense_id = data["id"]
        patched = client.patch(
            f"{EXPENSES_URL}/{expense_id}", {"amount": "26000.00"}, **host(), format="json"
        )
        assert patched.json()["data"]["amount"] == "26000.00"

        listed = client.get(EXPENSES_URL, {"category": str(categories["rent"].pk)}, **host())
        assert listed.json()["meta"]["count"] == 1

        summary = client.get(
            f"{EXPENSES_URL}/summary",
            {"date_from_bs": "2082-09-01", "date_to_bs": "2082-10-29", "group_by": "category"},
            **host(),
        )
        assert summary.json()["data"]["total"] == "26000.00"

        deleted = client.delete(f"{EXPENSES_URL}/{expense_id}", **host())
        assert deleted.json()["data"]["deleted"] is True

    def test_summary_group_by_validation(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "expense.view")
        response = auth_client(user).get(f"{EXPENSES_URL}/summary", {"group_by": "week"}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "GROUP_BY_INVALID"

    def test_unknown_category_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "expense.manage")
        response = auth_client(user).post(
            EXPENSES_URL,
            {
                "category": str(uuid.uuid4()),
                "amount": "100.00",
                "business_date_ad": "2026-01-10",
            },
            **host(),
            format="json",
        )
        assert response.status_code == 404

    def test_bad_date_filter_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "expense.view")
        response = auth_client(user).get(EXPENSES_URL, {"date_from_bs": "2082-13-99"}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_INVALID"

    def test_category_crud(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "expense.view", "expense.manage")
        client = auth_client(user)
        created = client.post(CATEGORIES_URL, {"name": "Marketing"}, **host())
        assert created.status_code == 201
        assert created.json()["data"]["is_active"] is True
        category_id = created.json()["data"]["id"]

        duplicate = client.post(CATEGORIES_URL, {"name": "Marketing"}, **host())
        assert duplicate.status_code == 400
        assert duplicate.json()["error"]["code"] == "ALREADY_EXISTS"

        deactivated = client.delete(f"{CATEGORIES_URL}/{category_id}", **host())
        assert deactivated.json()["data"]["is_active"] is False
