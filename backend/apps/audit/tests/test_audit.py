"""Audit tests — append-only enforcement, wired mutations, payloads, API."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from django.db import ProgrammingError, connection, transaction
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.audit.models import AuditLog
from apps.audit.services import audit
from apps.inventory.services import adjust_stock, post_opening_stock, write_off_damage
from apps.pricing import services as pricing_services
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from core.db.rls import revoke_update_delete_sql, set_local_tenant
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
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
def shop() -> dict[str, Any]:
    tenant = TenantFactory(slug=SLUG)
    user = UserFactory(tenant=tenant)
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
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
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


class TestAuditService:
    def test_row_shape_with_request_ip(self, shop: dict) -> None:
        from django.test import RequestFactory

        request = RequestFactory().get("/", REMOTE_ADDR="203.0.113.7")
        row = audit(
            shop["tenant"],
            actor=shop["user"],
            action="test.action",
            target_type="test",
            target_id=shop["variant"],
            before={"a": 1},
            after={"a": 2},
            request=request,
        )
        assert row.ip == "203.0.113.7"
        assert row.actor == shop["user"]
        assert row.before == {"a": 1}
        assert row.impersonated_by is None

    def test_forwarded_ip_takes_rightmost(self, shop: dict) -> None:
        from django.test import RequestFactory

        request = RequestFactory().get("/", HTTP_X_FORWARDED_FOR="198.51.100.1, 203.0.113.9")
        row = audit(
            shop["tenant"],
            actor=None,
            action="test.action",
            target_type="test",
            target_id=shop["variant"],
            request=request,
        )
        assert row.ip == "203.0.113.9"

    def test_no_request_means_null_ip(self, shop: dict) -> None:
        row = audit(
            shop["tenant"],
            actor=None,
            action="test.action",
            target_type="test",
            target_id=shop["variant"],
        )
        assert row.ip is None
        assert row.actor is None


class TestAppendOnly:
    def test_update_rejected_for_app_role(self, shop: dict) -> None:
        audit(
            shop["tenant"],
            actor=shop["user"],
            action="test.action",
            target_type="test",
            target_id=shop["variant"],
        )
        role = "dokan_app"
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                        CREATE ROLE {role} NOLOGIN;
                    END IF;
                END
                $$;
                """
            )
            cursor.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
            cursor.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}"
            )
            cursor.execute(revoke_update_delete_sql("audit_log"))
            cursor.execute(f"SET LOCAL ROLE {role}")
        set_local_tenant(connection, shop["tenant"].pk)

        row = AuditLog.objects.get(tenant=shop["tenant"])
        assert row.pk is not None  # INSERT works for the app role
        with pytest.raises(ProgrammingError), transaction.atomic():
            row.action = "edited"
            row.save(update_fields=["action"])


class TestWiredMutations:
    def test_price_set_writes_audit(self, shop: dict) -> None:
        pricing_services.set_price(
            shop["tenant"],
            rate_type=shop["rate_type"],
            scope="VARIANT",
            variant=shop["variant"],
            price=Decimal("900.00"),
            effective_from=date(2026, 1, 1),
            created_by=shop["user"],
        )
        row = AuditLog.objects.get(tenant=shop["tenant"], action="price.set")
        assert row.actor == shop["user"]
        assert row.target_type == "item_price"
        assert row.before == {"price": None}
        assert row.after is not None
        assert row.after["price"] == "900.00"
        assert row.after["scope"] == "VARIANT"

    def test_price_bounds_writes_audit(self, shop: dict) -> None:
        pricing_services.set_price_bounds(
            target=shop["variant"],
            min_selling_price=Decimal("800.00"),
            max_selling_price=Decimal("2000.00"),
            user=shop["user"],
        )
        row = AuditLog.objects.get(tenant=shop["tenant"], action="price.set_bounds")
        assert row.target_type == "itemvariant"
        assert row.before is not None and row.before["min_selling_price"] is None
        assert row.after is not None and row.after["min_selling_price"] == "800.00"

    def test_stock_adjust_writes_audit(self, shop: dict) -> None:
        adjust_stock(
            shop["tenant"],
            branch=shop["branch"],
            variant=shop["variant"],
            qty_delta=Decimal("-3"),
            reason="Count fix",
            created_by=shop["user"],
        )
        row = AuditLog.objects.get(tenant=shop["tenant"], action="stock.adjust")
        assert row.before is not None and row.before["qty_on_hand"] == "10.000"
        assert row.after is not None and row.after["qty_on_hand"] == "7.000"
        assert row.after is not None and row.after["reason"] == "Count fix"

    def test_write_off_writes_audit(self, shop: dict) -> None:
        write_off_damage(
            shop["tenant"],
            branch=shop["branch"],
            variant=shop["variant"],
            qty=Decimal("2"),
            reason="Rat damage",
            created_by=shop["user"],
        )
        row = AuditLog.objects.get(tenant=shop["tenant"], action="stock.write_off")
        assert row.after is not None and row.after["qty_on_hand"] == "8.000"

    def test_cancel_held_bill_writes_audit(self, shop: dict) -> None:
        held = sale_services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            lines=[
                SaleLineInput(
                    variant=shop["variant"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="hold-1",
            created_by=shop["user"],
        ).invoice
        sale_services.cancel_held_bill(shop["tenant"], invoice=held)
        row = AuditLog.objects.get(tenant=shop["tenant"], action="sale.cancel_held")
        assert row.before == {"status": "HELD"}
        assert row.after == {"status": "CANCELLED"}

    def test_reads_write_nothing(self, shop: dict) -> None:
        from apps.reports.selectors import daily_sales

        daily_sales(shop["tenant"], shop["user"])
        list(shop["variant"].stock_movements.all())
        assert AuditLog.objects.filter(tenant=shop["tenant"]).count() == 0


class TestAuditApi:
    def test_unauthenticated_is_401(self, shop: dict) -> None:
        assert APIClient().get("/api/v1/audit/", **host()).status_code == 401

    def test_requires_settings_manage(self, shop: dict) -> None:
        grant(shop["tenant"], shop["user"], "report.sales")
        assert auth_client(shop["user"]).get("/api/v1/audit/", **host()).status_code == 403

    def test_list_and_filters(self, shop: dict) -> None:
        pricing_services.set_price(
            shop["tenant"],
            rate_type=shop["rate_type"],
            scope="VARIANT",
            variant=shop["variant"],
            price=Decimal("900.00"),
            effective_from=date(2026, 1, 1),
            created_by=shop["user"],
        )
        adjust_stock(
            shop["tenant"],
            branch=shop["branch"],
            variant=shop["variant"],
            qty_delta=Decimal("1"),
            reason="Found",
            created_by=shop["user"],
        )
        grant(shop["tenant"], shop["user"], "settings.manage")
        client = auth_client(shop["user"])

        listed = client.get("/api/v1/audit/", **host())
        assert listed.status_code == 200
        assert listed.json()["meta"]["count"] == 3
        rows = listed.json()["data"]
        assert rows[0]["actor_name"] == shop["user"].full_name
        assert {row["action"] for row in rows} == {
            "auth.login",
            "price.set",
            "stock.adjust",
        }

        by_action = client.get("/api/v1/audit/", {"action": "price.set"}, **host())
        assert by_action.json()["meta"]["count"] == 1
        assert by_action.json()["data"][0]["action"] == "price.set"

        by_target = client.get("/api/v1/audit/", {"target_type": "stock_level"}, **host())
        assert by_target.json()["meta"]["count"] == 1

        from datetime import date as date_type
        from datetime import timedelta

        future = (date_type.today() + timedelta(days=1)).isoformat()
        out_of_range = client.get("/api/v1/audit/", {"date_from": future}, **host())
        assert out_of_range.json()["meta"]["count"] == 0

    def test_bad_date_is_400(self, shop: dict) -> None:
        grant(shop["tenant"], shop["user"], "settings.manage")
        response = auth_client(shop["user"]).get("/api/v1/audit/", {"date_from": "junk"}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_INVALID"
