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
    SupplierFactory,
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


class TestOpenClose:
    def test_open_and_get_current(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("1000.00"),
            opened_by=shop["user"],
        )
        assert services.get_open_session(shop["tenant"], shop["branch"]).pk == session.pk

    def test_second_open_is_409(self, shop: dict) -> None:
        services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("1000.00"),
            opened_by=shop["user"],
        )
        with pytest.raises(ServiceError) as exc:
            services.open_session(
                shop["tenant"],
                branch=shop["branch"],
                opening_float=Decimal("500.00"),
                opened_by=shop["user"],
            )
        assert exc.value.code == "SESSION_ALREADY_OPEN"

    def test_negative_float_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.open_session(
                shop["tenant"],
                branch=shop["branch"],
                opening_float=Decimal("-1.00"),
                opened_by=shop["user"],
            )
        assert exc.value.code == "FLOAT_INVALID"

    def test_double_close_is_409(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("1000.00"),
            opened_by=shop["user"],
        )
        services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("1000.00"),
            closed_by=shop["user"],
        )
        with pytest.raises(ServiceError) as exc:
            services.close_session(
                shop["tenant"],
                session=session,
                counted_cash=Decimal("1000.00"),
                closed_by=shop["user"],
            )
        assert exc.value.code == "SESSION_ALREADY_CLOSED"

    def test_get_open_session_none_when_closed(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("100.00"),
            opened_by=shop["user"],
        )
        services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("100.00"),
            closed_by=shop["user"],
        )
        assert services.get_open_session(shop["tenant"], shop["branch"]) is None


class TestExpectedCash:
    def test_non_cash_sale_tender_is_not_drawer_cash(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("100.00"),
            opened_by=shop["user"],
        )
        sale_services.create_sale(
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
            payments=[{"method": "ESEWA", "amount": Decimal("1000.00")}],
            idempotency_key="s-noncash",
            created_by=shop["user"],
        )

        closed = services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("100.00"),
            closed_by=shop["user"],
        )
        assert closed.expected_cash == Decimal("100.00")

    def test_cash_supplier_payment_leaves_the_drawer(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("500.00"),
            opened_by=shop["user"],
        )
        services.record_payment(
            shop["tenant"],
            branch=shop["branch"],
            supplier=SupplierFactory(tenant=shop["tenant"]),
            amount=Decimal("200.00"),
            method="CASH",
            idempotency_key="supplier-cash",
            created_by=shop["user"],
        )

        closed = services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("300.00"),
            closed_by=shop["user"],
        )
        assert closed.expected_cash == Decimal("300.00")

    def test_reversed_cash_receipt_nets_to_zero(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("100.00"),
            opened_by=shop["user"],
        )
        original = services.record_receipt(
            shop["tenant"],
            branch=shop["branch"],
            customer=shop["customer"],
            amount=Decimal("300.00"),
            method="CASH",
            idempotency_key="receipt-cash",
            created_by=shop["user"],
        ).payment
        services.reverse_payment(
            shop["tenant"],
            payment=original,
            reason="Duplicate receipt",
            idempotency_key="receipt-cash-reversal",
            created_by=shop["user"],
        )

        closed = services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("100.00"),
            closed_by=shop["user"],
        )
        assert closed.expected_cash == Decimal("100.00")

    def test_expected_with_sale_receipt_and_refund_in_window(self, shop: dict) -> None:
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("1000.00"),
            opened_by=shop["user"],
        )
        # CASH sale of 2000 in the window.
        original = sale_services.create_sale(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            customer=shop["customer"],
            lines=[
                SaleLineInput(
                    variant=shop["variant"],
                    qty=Decimal("2"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            payments=[{"method": "CASH", "amount": Decimal("2000.00")}],
            idempotency_key="s-1",
            created_by=shop["user"],
        ).invoice
        # CASH receipt of 500.
        services.record_receipt(
            shop["tenant"],
            branch=shop["branch"],
            customer=shop["customer"],
            amount=Decimal("500.00"),
            method="CASH",
            idempotency_key="r-1",
            created_by=shop["user"],
        )
        # CASH refund of 200 via a return.
        sale_services.create_return(
            shop["tenant"],
            original_invoice=original,
            lines=[sale_services.ReturnLineInput(variant=shop["variant"], qty=Decimal("1"))],
            reason="Wrong size",
            refunds=[{"method": "CASH", "amount": Decimal("200.00")}],
            idempotency_key="ret-1",
            created_by=shop["user"],
        )

        closed = services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("3200.00"),
            closed_by=shop["user"],
        )
        # expected = 1000 float + 2000 sale + 500 receipt − 200 refund
        assert closed.expected_cash == Decimal("3300.00")
        assert closed.counted_cash == Decimal("3200.00")
        assert closed.variance == Decimal("-100.00")
        assert closed.closed_at is not None

    def test_out_of_window_activity_not_counted(self, shop: dict) -> None:
        # Sale BEFORE the session opens: not in the expected total.
        sale_services.create_sale(
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
            payments=[{"method": "CASH", "amount": Decimal("1000.00")}],
            idempotency_key="s-old",
            created_by=shop["user"],
        )
        session = services.open_session(
            shop["tenant"],
            branch=shop["branch"],
            opening_float=Decimal("100.00"),
            opened_by=shop["user"],
        )
        closed = services.close_session(
            shop["tenant"],
            session=session,
            counted_cash=Decimal("100.00"),
            closed_by=shop["user"],
        )
        assert closed.expected_cash == Decimal("100.00")


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
