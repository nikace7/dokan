"""Money rules: the round-off on a full return, what a return may be made
against, and the price a parked bill was quoted at."""

from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.services import post_opening_stock
from apps.sales import services
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
    """2 x 250.30 = 500.60, rounded off by -0.60 to 500.00, paid in cash."""
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(tenant=tenant, item=ItemFactory(tenant=tenant), mrp=None)
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("10"),
        unit_cost=Decimal("100.00"),
        created_by=user,
    )
    original = services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=CustomerFactory(tenant=tenant),
        lines=[
            SaleLineInput(
                variant=variant,
                qty=Decimal("2"),
                unit_price=Decimal("250.30"),
                discount=Decimal("0"),
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("500.00")}],
        round_off=Decimal("-0.60"),
        idempotency_key="sale-1",
        created_by=user,
    ).invoice
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
        "original": original,
    }


def _return(shop: dict[str, Any], qty: str, key: str, original: Any = None) -> Any:
    return services.create_return(
        shop["tenant"],
        original_invoice=original or shop["original"],
        lines=[ReturnLineInput(variant=shop["variant"], qty=Decimal(qty))],
        reason="Did not fit",
        idempotency_key=key,
        created_by=shop["user"],
    ).invoice


def test_a_full_return_gives_back_what_was_paid(shop: dict[str, Any]) -> None:
    returned = _return(shop, "2", "r-all")

    assert returned.round_off == Decimal("-0.60")
    assert returned.total == Decimal("500.00")


def test_the_last_return_of_a_bill_carries_the_round_off(shop: dict[str, Any]) -> None:
    first = _return(shop, "1", "r-1")
    last = _return(shop, "1", "r-2")

    assert first.round_off == Decimal("0")
    assert first.total == Decimal("250.30")
    assert last.round_off == Decimal("-0.60")
    assert first.total + last.total == shop["original"].total


def test_the_quote_of_a_full_return_matches_it(shop: dict[str, Any]) -> None:
    quote = services.quote_return(
        shop["tenant"],
        original=shop["original"],
        returned_lines=[ReturnLineInput(variant=shop["variant"], qty=Decimal("2"))],
        new_lines=[],
        user=shop["user"],
    )

    assert quote.return_total == Decimal("500.00")


def test_a_return_cannot_itself_be_returned(shop: dict[str, Any]) -> None:
    returned = _return(shop, "1", "r-1")

    with pytest.raises(ServiceError) as exc:
        _return(shop, "1", "r-of-r", original=returned)

    assert exc.value.code == "RETURN_NOT_ALLOWED"
    assert exc.value.http_status == 409


def test_a_parked_bill_keeps_the_price_it_was_parked_at(shop: dict[str, Any]) -> None:
    variant = shop["variant"]
    variant.mrp = Decimal("1000.00")
    variant.save(update_fields=["mrp"])
    held = services.hold_bill(
        shop["tenant"],
        branch=shop["branch"],
        rate_type=shop["rate_type"],
        lines=[
            SaleLineInput(variant=variant, qty=Decimal("1"), unit_price=None, discount=Decimal("0"))
        ],
        idempotency_key="hold-1",
        created_by=shop["user"],
    ).invoice
    # The shop raises the price and its floor while the customer waits.
    variant.mrp = Decimal("1300.00")
    variant.min_selling_price = Decimal("1200.00")
    variant.save(update_fields=["mrp", "min_selling_price"])

    completed = services.complete_held_bill(
        shop["tenant"],
        invoice=held,
        payments=[{"method": "CASH", "amount": Decimal("1000.00")}],
        created_by=shop["user"],
    )

    assert completed.total == Decimal("1000.00")


def test_a_gap_bigger_than_rounding_keeps_the_bills_own_round_off(
    shop: dict[str, Any],
) -> None:
    # An earlier return recorded with different figures leaves more than a
    # rupee unaccounted for: that is not rounding, so only the bill's own
    # round-off goes back.
    first = _return(shop, "1", "r-1")
    first.total = Decimal("240.00")
    first.save(update_fields=["total"])

    last = _return(shop, "1", "r-2")

    assert last.round_off == Decimal("-0.60")


def test_sending_back_the_shops_own_price_is_not_held_to_the_limits(
    shop: dict[str, Any],
) -> None:
    # An online order carries the price the shop showed; the limits are for
    # prices a cashier types.
    variant = shop["variant"]
    variant.mrp = Decimal("1000.00")
    variant.max_selling_price = Decimal("900.00")
    variant.save(update_fields=["mrp", "max_selling_price"])

    sale = services.create_sale(
        shop["tenant"],
        branch=shop["branch"],
        rate_type=shop["rate_type"],
        lines=[
            SaleLineInput(
                variant=variant,
                qty=Decimal("1"),
                unit_price=Decimal("1000.00"),
                discount=Decimal("0"),
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("1000.00")}],
        idempotency_key="sale-shop-price",
        created_by=shop["user"],
    ).invoice

    assert sale.total == Decimal("1000.00")
