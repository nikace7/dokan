"""Cash session tests — open/close lifecycle and expected-cash math."""

from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.services import post_opening_stock
from apps.payments import services
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
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


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("100"),
        unit_cost=Decimal("500.00"),
        created_by=user,
    )
    customer = CustomerFactory(tenant=tenant, credit_limit=None)
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
        "customer": customer,
    }


class TestCloseValidation:
    def test_negative_count_rejected(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("100.00"),
            opened_by=shop["user"],
        )
        with pytest.raises(ServiceError) as exc:
            services.close_session(
                shop["tenant"],
                session=session,
                counted_cash=Decimal("-1.00"),
                closed_by=shop["user"],
            )
        assert exc.value.code == "COUNT_INVALID"

    def test_non_cash_refund_not_subtracted(self, shop: dict) -> None:
        """A CREDIT_NOTE refund in the window does not reduce expected cash."""
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("100.00"),
            opened_by=shop["user"],
        )
        original = sale_services.create_sale(
            shop["tenant"],
            branch=shop["branch"],
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
            payments=[],  # full udharo — the credit note has dues to settle against
            idempotency_key="s-1",
            created_by=shop["user"],
        ).invoice
        sale_services.create_return(
            shop["tenant"],
            original_invoice=original,
            lines=[sale_services.ReturnLineInput(variant=shop["variant"], qty=Decimal("1"))],
            reason="Wrong size",
            refunds=[{"method": "CREDIT_NOTE", "amount": Decimal("1000.00")}],
            idempotency_key="ret-cn",
            created_by=shop["user"],
        )
        closed = services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("100.00"),
            closed_by=shop["user"],
        )
        assert closed.expected_cash == Decimal("100.00")  # just the float
