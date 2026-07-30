"""Sales concurrency tests — the two races that cost shops money.

1. Gapless numbering under concurrency: two threads completing bills on
   the same branch get consecutive numbers — no gaps, no duplicates (the
   row-locked number_sequence serializes allocation).
2. Two simultaneous sales of the last item: one succeeds, one gets
   STOCK_INSUFFICIENT; stock never goes negative (the FOR UPDATE lock on
   the stock_level row serializes the check).

Runs transaction=True (setup data committed, visible to both worker
connections) with serialized_rollback so the flush afterwards restores
the seeded permission catalog.
"""

import threading
from decimal import Decimal
from typing import Any

import pytest
from django.db import connections

from apps.inventory.models import StockLevel
from apps.inventory.services import post_opening_stock
from apps.sales import services
from apps.sales.models import SalesInvoice
from core.responses import ServiceError
from tests.factories import (
    BranchFactory,
    ItemVariantFactory,
    RateTypeFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db(transaction=True, serialized_rollback=True)


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("500.00"))
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
    }


def _one_item_sale(shop: dict, key: str, qty: Decimal = Decimal("1")) -> Any:
    return services.create_sale(
        shop["tenant"],
        branch=shop["branch"],
        rate_type=shop["rate_type"],
        lines=[
            services.SaleLineInput(
                variant=shop["variant"], qty=qty, unit_price=None, discount=Decimal("0")
            )
        ],
        payments=[{"method": "CASH", "amount": Decimal("500.00")}],
        idempotency_key=key,
        created_by=shop["user"],
    )


def test_gapless_numbering_under_concurrency(shop: dict) -> None:
    post_opening_stock(
        shop["tenant"],
        branch=shop["branch"],
        variant=shop["variant"],
        qty=Decimal("100"),
        unit_cost=Decimal("300.00"),
        created_by=shop["user"],
    )
    barrier = threading.Barrier(3)
    errors: list[BaseException] = []

    def work(prefix: str) -> None:
        try:
            barrier.wait(timeout=15)
            for n in range(5):
                _one_item_sale(shop, f"{prefix}-{n}")
        except BaseException as exc:
            errors.append(exc)
        finally:
            connections["default"].close()

    thread_a = threading.Thread(target=work, args=("a",))
    thread_b = threading.Thread(target=work, args=("b",))
    thread_a.start()
    thread_b.start()
    barrier.wait(timeout=15)
    thread_a.join(timeout=600)
    thread_b.join(timeout=600)

    assert not thread_a.is_alive() and not thread_b.is_alive(), "worker deadlocked"
    assert not errors, f"worker failed: {errors[0]!r}"

    numbers = sorted(
        n
        for n in SalesInvoice.objects.filter(tenant=shop["tenant"]).values_list(
            "invoice_no", flat=True
        )
        if n is not None
    )
    assert numbers == list(range(1, 11))  # 10 bills, numbers 1..10, no gaps/dups


def test_two_sales_of_the_last_item(shop: dict) -> None:
    """Stock is 1; two threads sell qty 1. Exactly one may win."""
    post_opening_stock(
        shop["tenant"],
        branch=shop["branch"],
        variant=shop["variant"],
        qty=Decimal("1"),
        unit_cost=Decimal("300.00"),
        created_by=shop["user"],
    )
    barrier = threading.Barrier(3)
    outcomes: dict[str, Any] = {}

    def work(name: str, key: str) -> None:
        try:
            barrier.wait(timeout=15)
            _one_item_sale(shop, key)
            outcomes[name] = "sold"
        except ServiceError as exc:
            outcomes[name] = exc.code
        finally:
            connections["default"].close()

    thread_a = threading.Thread(target=work, args=("a", "race-a"))
    thread_b = threading.Thread(target=work, args=("b", "race-b"))
    thread_a.start()
    thread_b.start()
    barrier.wait(timeout=15)
    thread_a.join(timeout=600)
    thread_b.join(timeout=600)

    assert not thread_a.is_alive() and not thread_b.is_alive(), "worker deadlocked"
    assert sorted(outcomes.values()) == ["STOCK_INSUFFICIENT", "sold"]
    level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant"])
    assert level.qty_on_hand == Decimal("0")  # never negative
