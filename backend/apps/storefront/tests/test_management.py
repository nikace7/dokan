"""Tenant-staff workflow for accepting and fulfilling online orders."""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.audit.models import AuditLog
from apps.sales.models import SalesInvoice
from apps.storefront.models import StoreOrder
from apps.storefront.tests.test_api import make_shop
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    StoreCustomerFactory,
    StoreOrderFactory,
    StoreOrderItemFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db


def pos_host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant,
            role=role,
            permission=Permission.objects.get(code=code),
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **pos_host(slug),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


def prepared_order() -> tuple[Any, Any, Any]:
    tenant = make_shop(slug="orders-shop", shopfront="orders")
    branch = BranchFactory(tenant=tenant, is_default=True)
    RateTypeFactory(tenant=tenant, is_default=True)
    customer = StoreCustomerFactory(
        tenant=tenant,
        email="buyer@example.com",
        full_name="Sita Buyer",
        phone="9812345678",
    )
    item = ItemFactory(
        tenant=tenant,
        name="Winter Coat",
        website_visible=True,
        website_price=Decimal("1800.00"),
    )
    variant = ItemVariantFactory(
        tenant=tenant,
        item=item,
        min_selling_price=Decimal("1000.00"),
        max_selling_price=Decimal("2500.00"),
    )
    order = StoreOrderFactory(
        tenant=tenant,
        branch=branch,
        customer=customer,
        subtotal=Decimal("1800.00"),
        total=Decimal("1800.00"),
    )
    StoreOrderItemFactory(
        tenant=tenant,
        order=order,
        variant=variant,
        name=item.name,
        unit_price=Decimal("1800.00"),
        line_total=Decimal("1800.00"),
    )
    user = UserFactory(tenant=tenant)
    return tenant, user, order


class TestOrderManagement:
    def test_list_requires_sale_view_and_is_tenant_scoped(self) -> None:
        tenant, user, order = prepared_order()
        grant(tenant, user, "sale.view")

        response = auth_client(user, tenant.slug).get(
            "/api/v1/storefront/manage/orders",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 200
        assert [row["id"] for row in response.json()["data"]] == [str(order.pk)]

    def test_prepare_creates_one_linked_held_sale_and_audits(self) -> None:
        tenant, user, order = prepared_order()
        grant(tenant, user, "sale.create")
        client = auth_client(user, tenant.slug)
        url = f"/api/v1/storefront/manage/orders/{order.pk}/prepare"

        first = client.post(url, {}, format="json", **pos_host(tenant.slug))
        second = client.post(url, {}, format="json", **pos_host(tenant.slug))

        assert first.status_code == 200
        assert second.status_code == 200
        order.refresh_from_db()
        assert order.status == StoreOrder.Status.CONFIRMED
        assert order.sales_invoice is not None
        assert order.sales_invoice.status == SalesInvoice.Status.HELD
        assert order.sales_invoice.customer is not None
        assert SalesInvoice.objects.filter(tenant=tenant).count() == 1
        assert (
            AuditLog.objects.filter(
                tenant=tenant,
                action="store.order.prepare",
                target_id=order.pk,
            ).count()
            == 1
        )

    def test_advance_follows_the_fulfillment_state_machine(self) -> None:
        tenant, user, order = prepared_order()
        order.status = StoreOrder.Status.CONFIRMED
        order.save(update_fields=["status", "updated_at"])
        grant(tenant, user, "sale.create")
        client = auth_client(user, tenant.slug)
        url = f"/api/v1/storefront/manage/orders/{order.pk}/advance"

        packed = client.post(url, {}, format="json", **pos_host(tenant.slug))
        shipped = client.post(url, {}, format="json", **pos_host(tenant.slug))
        blocked = client.post(url, {}, format="json", **pos_host(tenant.slug))

        assert packed.json()["data"]["status"] == "PACKED"
        assert shipped.json()["data"]["status"] == "SHIPPED"
        assert blocked.status_code == 409
        assert blocked.json()["error"]["code"] == "SALE_NOT_COMPLETED"

    def test_cancel_releases_a_prepared_order_and_held_bill(self) -> None:
        tenant, user, order = prepared_order()
        grant(tenant, user, "sale.create", "sale.void")
        client = auth_client(user, tenant.slug)
        client.post(
            f"/api/v1/storefront/manage/orders/{order.pk}/prepare",
            {},
            format="json",
            **pos_host(tenant.slug),
        )

        response = client.post(
            f"/api/v1/storefront/manage/orders/{order.pk}/cancel",
            {},
            format="json",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 200
        order.refresh_from_db()
        assert order.status == StoreOrder.Status.CANCELLED
        assert order.sales_invoice.status == SalesInvoice.Status.CANCELLED

    def test_management_routes_require_staff_authentication(self) -> None:
        tenant, _, order = prepared_order()

        response = APIClient().post(
            f"/api/v1/storefront/manage/orders/{order.pk}/prepare",
            {},
            format="json",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 401
