"""The sale dropdown carries what a sale at the chosen rate charges."""

from decimal import Decimal
from typing import Any

import pytest

from apps.catalog.tests.test_for_sale_api import (
    URL,
    auth_client,
    branch,
    grant,
    host,
    stocked_variant,
    tenant,
    user,
)
from tests.factories import ItemPriceFactory, RateTypeFactory

__all__ = ["branch", "tenant", "user"]

pytestmark = pytest.mark.django_db


def test_rows_carry_the_price_at_the_chosen_rate(tenant: Any, user: Any, branch: Any) -> None:
    grant(tenant, user, "sale.create")
    rate = RateTypeFactory(tenant=tenant)
    priced = stocked_variant(tenant, branch, mrp=Decimal("1500.00"))
    ItemPriceFactory(tenant=tenant, rate_type=rate, variant=priced, price=Decimal("1200.00"))
    at_mrp = stocked_variant(tenant, branch, mrp=Decimal("900.00"))
    unpriced = stocked_variant(tenant, branch, mrp=None)

    rows = (
        auth_client(user)
        .get(URL, {"branch_id": str(branch.pk), "rate_type": str(rate.pk)}, **host())
        .json()["data"]
    )

    prices = {row["id"]: row["price"] for row in rows}
    assert prices[str(priced.pk)] == "1200.00"
    assert prices[str(at_mrp.pk)] == "900.00"
    assert prices[str(unpriced.pk)] is None


def test_without_a_rate_rows_carry_no_price(tenant: Any, user: Any, branch: Any) -> None:
    grant(tenant, user, "sale.create")
    stocked_variant(tenant, branch, mrp=Decimal("1500.00"))

    rows = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host()).json()["data"]

    assert "price" not in rows[0]


def test_a_rate_the_cashier_may_not_use_is_refused(tenant: Any, user: Any, branch: Any) -> None:
    from apps.accounts.models import Permission

    grant(tenant, user, "sale.create")
    rate = RateTypeFactory(
        tenant=tenant, required_permission=Permission.objects.get(code="pricing.override_min")
    )
    stocked_variant(tenant, branch, mrp=Decimal("1500.00"))

    response = auth_client(user).get(
        URL, {"branch_id": str(branch.pk), "rate_type": str(rate.pk)}, **host()
    )

    assert response.status_code == 403
