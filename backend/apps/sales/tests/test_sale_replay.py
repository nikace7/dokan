"""A reused Idempotency-Key replays only the bill that created it.

Returning the old invoice for a DIFFERENT bill shows "Sale completed" at the
counter while the newly added items leave the shop unbilled.
"""

from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.services import post_opening_stock
from apps.payments import services as payment_services
from apps.sales import services
from apps.sales.models import SalesInvoice
from core.responses import ServiceError
from tests.factories import (
    BranchFactory,
    CustomerFactory,
    ItemVariantFactory,
    RateTypeFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db

KEY = "k-1"


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("20"),
        unit_cost=Decimal("500.00"),
        created_by=user,
    )
    payment_services.open_session(
        tenant, branch=branch, opening_float=Decimal("0.00"), opened_by=user
    )
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": RateTypeFactory(tenant=tenant, is_default=True),
        "variant": variant,
    }


def line(
    shop: dict[str, Any], qty: str = "2", price: str | None = None, discount: str = "0"
) -> Any:
    return services.SaleLineInput(
        variant=shop["variant"],
        qty=Decimal(qty),
        unit_price=Decimal(price) if price else None,
        discount=Decimal(discount),
    )


def sell(shop: dict[str, Any], **overrides: Any) -> services.SaleResult:
    request: dict[str, Any] = {
        "branch": shop["branch"],
        "rate_type": shop["rate_type"],
        "lines": [line(shop)],
        "payments": [{"method": "CASH", "amount": Decimal("2000.00")}],
        "idempotency_key": KEY,
        "created_by": shop["user"],
        "require_open_cash_session": True,
        **overrides,
    }
    return services.create_sale(shop["tenant"], **request)


@pytest.mark.parametrize(
    "changed",
    [
        lambda shop: {"lines": [line(shop, qty="3")]},
        lambda shop: {"lines": [line(shop), line(shop, qty="1")]},
        lambda shop: {"lines": [line(shop, price="900")]},
        lambda shop: {"lines": [line(shop, discount="50")]},
        lambda shop: {"payments": [{"method": "QR", "amount": Decimal("2000.00")}]},
        lambda shop: {"customer": CustomerFactory(tenant=shop["tenant"])},
        lambda shop: {"rate_type": RateTypeFactory(tenant=shop["tenant"])},
        lambda shop: {"branch": BranchFactory(tenant=shop["tenant"])},
        lambda shop: {"is_vat_bill": True},
        lambda shop: {"bill_discount": Decimal("100.00")},
        lambda shop: {"round_off": Decimal("1.00")},
    ],
    ids=[
        "qty",
        "extra-line",
        "price",
        "line-discount",
        "tender",
        "customer",
        "rate-type",
        "branch",
        "vat",
        "bill-discount",
        "round-off",
    ],
)
def test_reused_key_with_a_different_bill_is_refused(shop: dict[str, Any], changed: Any) -> None:
    sell(shop)

    with pytest.raises(ServiceError) as exc:
        sell(shop, **changed(shop))

    assert exc.value.code == "IDEMPOTENCY_KEY_REUSED"
    assert exc.value.http_status == 409
    assert SalesInvoice.objects.filter(tenant=shop["tenant"]).count() == 1


# False is the offline-sync path: the replay is found by the unique key instead
# of the up-front lookup.
@pytest.mark.parametrize("require_open_cash_session", [True, False])
def test_replay_matches_however_the_same_numbers_are_written(
    shop: dict[str, Any], require_open_cash_session: bool
) -> None:
    first = sell(
        shop,
        lines=[line(shop, price="1000")],
        require_open_cash_session=require_open_cash_session,
    )
    second = sell(
        shop,
        lines=[line(shop, qty="2.000", price="1000.00", discount="0.00")],
        payments=[{"method": "CASH", "amount": Decimal("2000")}],
        round_off=Decimal("0.00"),
        require_open_cash_session=require_open_cash_session,
    )

    assert second.replayed is True
    assert second.invoice.pk == first.invoice.pk


def test_server_priced_bill_replays_after_a_price_change(shop: dict[str, Any]) -> None:
    first = sell(shop)
    shop["variant"].mrp = Decimal("900.00")
    shop["variant"].save()

    second = sell(shop)

    assert second.replayed is True
    assert second.invoice.pk == first.invoice.pk
