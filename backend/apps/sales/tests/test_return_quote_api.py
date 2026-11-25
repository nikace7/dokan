"""The return quote must say exactly what the return or exchange then records."""

from decimal import Decimal
from typing import Any

import pytest

from apps.sales import services
from apps.sales.models import SalesInvoice
from apps.sales.services import SaleLineInput
from apps.sales.tests.test_returns_api import (
    EXCHANGES_URL,
    RETURNS_URL,
    auth_client,
    grant,
    host,
    shop,
    tenant,
    user,
)
from tests.factories import ItemVariantFactory, TenantFactory, UserFactory

__all__ = ["shop", "tenant", "user"]

pytestmark = pytest.mark.django_db


def quote_url(invoice: Any) -> str:
    return f"/api/v1/sales/{invoice.pk}/return-quote"


def returned(shop: dict[str, Any], qty: str) -> list[dict[str, str]]:
    return [{"variant": str(shop["variant"].pk), "qty": qty}]


def test_quote_matches_the_return_of_a_discounted_vat_bill(
    tenant: Any, user: Any, shop: dict[str, Any]
) -> None:
    tenant.vat_registered = True
    tenant.save(update_fields=["vat_registered"])
    original = services.create_sale(
        tenant,
        branch=shop["branch"],
        rate_type=shop["rate_type"],
        customer=shop["customer"],
        is_vat_bill=True,
        bill_discount=Decimal("100.00"),
        lines=[
            SaleLineInput(
                variant=shop["variant"],
                qty=Decimal("3"),
                unit_price=None,
                discount=Decimal("50.00"),
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("100.00")}],
        idempotency_key="vat-sale",
        created_by=user,
    ).invoice
    grant(tenant, user, "sale.return")
    client = auth_client(user)

    quote = client.post(
        quote_url(original), {"returned_lines": returned(shop, "2")}, **host(), format="json"
    )
    recorded = client.post(
        RETURNS_URL,
        {
            "original_invoice": str(original.pk),
            "lines": returned(shop, "2"),
            "reason": "Wrong size",
        },
        **host(),
        format="json",
        HTTP_IDEMPOTENCY_KEY="r-vat",
    )

    assert quote.status_code == 200
    assert recorded.status_code == 201
    assert quote.json()["data"]["return_total"] == recorded.json()["data"]["total"]
    assert Decimal(recorded.json()["data"]["total"]) > 0


@pytest.mark.parametrize(
    ("new_price", "collect", "refund"),
    [("1200.00", "200.00", "0.00"), ("1000.00", "0.00", "0.00"), ("700.00", "0.00", "300.00")],
)
def test_quote_matches_the_exchange(
    tenant: Any, user: Any, shop: dict[str, Any], new_price: str, collect: str, refund: str
) -> None:
    from apps.inventory.services import post_opening_stock

    other = ItemVariantFactory(tenant=tenant, mrp=Decimal(new_price))
    post_opening_stock(
        tenant,
        branch=shop["branch"],
        variant=other,
        qty=Decimal("5"),
        unit_cost=Decimal("300.00"),
        created_by=user,
    )
    grant(tenant, user, "sale.return")
    client = auth_client(user)
    body = {
        "returned_lines": returned(shop, "1"),
        "new_lines": [{"variant": str(other.pk), "qty": "1"}],
    }

    quote = client.post(quote_url(shop["original"]), body, **host(), format="json").json()["data"]

    assert quote["return_total"] == "1000.00"
    assert quote["new_total"] == new_price
    assert quote["to_collect"] == collect
    assert quote["to_refund"] == refund
    recorded = client.post(
        EXCHANGES_URL,
        {
            **body,
            "original_invoice": str(shop["original"].pk),
            "payments": [{"method": "CASH", "amount": collect}] if collect != "0.00" else [],
            "reason": "Wrong size",
        },
        **host(),
        format="json",
        HTTP_IDEMPOTENCY_KEY="ex-quote",
    )
    assert recorded.status_code == 201
    assert recorded.json()["data"]["refund_amount"] == refund
    assert recorded.json()["data"]["sale_invoice"]["due_amount"] == "0.00"


def test_quote_caps_the_credit_note_at_what_the_customer_owes(
    tenant: Any, user: Any, shop: dict[str, Any]
) -> None:
    grant(tenant, user, "sale.return")
    client = auth_client(user)

    data = client.post(
        quote_url(shop["original"]),
        {"returned_lines": returned(shop, "1")},
        **host(),
        format="json",
    ).json()["data"]

    # 2000 sold, 1500 paid.
    assert data["return_total"] == "1000.00"
    assert data["max_credit_note"] == "500.00"


def test_quote_changes_nothing(tenant: Any, user: Any, shop: dict[str, Any]) -> None:
    grant(tenant, user, "sale.return")
    before = SalesInvoice.objects.count()

    auth_client(user).post(
        quote_url(shop["original"]),
        {"returned_lines": returned(shop, "2")},
        **host(),
        format="json",
    )

    assert SalesInvoice.objects.count() == before
    assert shop["original"].items.get().returned_qty == Decimal("0")


def test_quote_refuses_more_than_was_bought(tenant: Any, user: Any, shop: dict[str, Any]) -> None:
    grant(tenant, user, "sale.return")

    response = auth_client(user).post(
        quote_url(shop["original"]),
        {"returned_lines": returned(shop, "3")},
        **host(),
        format="json",
    )

    assert response.json()["error"]["code"] == "OVER_RETURN"


def test_quote_needs_the_return_permission(tenant: Any, user: Any, shop: dict[str, Any]) -> None:
    grant(tenant, user, "sale.view")

    response = auth_client(user).post(
        quote_url(shop["original"]),
        {"returned_lines": returned(shop, "1")},
        **host(),
        format="json",
    )

    assert response.status_code == 403


def test_another_shops_bill_is_not_found(tenant: Any, user: Any, shop: dict[str, Any]) -> None:
    other = TenantFactory(slug="other")
    stranger = UserFactory(tenant=other)
    grant(other, stranger, "sale.return")

    response = auth_client(stranger, "other").post(
        quote_url(shop["original"]),
        {"returned_lines": returned(shop, "1")},
        **host("other"),
        format="json",
    )

    assert response.status_code == 404
