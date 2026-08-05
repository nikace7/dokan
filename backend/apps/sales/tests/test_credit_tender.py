"""Regression tests: CREDIT tender must equal the computed due exactly.

The tenders JSON feeds cash-session reconciliation and due_amount feeds
the canonical outstanding selector — a CREDIT tender that disagrees with
due_amount would split the same udharo into two different truths.
"""

from decimal import Decimal
from typing import Any

import pytest

from apps.payments.selectors import customer_outstanding
from apps.sales import services
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
    from apps.inventory.services import post_opening_stock

    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("20"),
        unit_cost=Decimal("500.00"),
        created_by=user,
    )
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
        "customer": CustomerFactory(tenant=tenant, credit_limit=None),
    }


def _sale(shop: dict, payments: list[dict[str, Any]], key: str = "k-1") -> Any:
    return services.create_sale(
        shop["tenant"],
        branch=shop["branch"],
        rate_type=shop["rate_type"],
        customer=shop["customer"],
        lines=[
            services.SaleLineInput(
                variant=shop["variant"],
                qty=Decimal("1"),
                unit_price=None,
                discount=Decimal("0"),
            )
        ],
        payments=payments,
        idempotency_key=key,
        created_by=shop["user"],
    ).invoice


class TestCreditTenderConsistency:
    def test_matching_credit_tender_accepted(self, shop: dict) -> None:
        invoice = _sale(
            shop,
            [
                {"method": "CASH", "amount": Decimal("300.00")},
                {"method": "CREDIT", "amount": Decimal("700.00")},
            ],
        )
        assert invoice.paid_amount == Decimal("300.00")
        assert invoice.due_amount == Decimal("700.00")
        assert invoice.tenders == [
            {"method": "CASH", "amount": "300.00"},
            {"method": "CREDIT", "amount": "700.00"},
        ]

    def test_full_credit_tender_accepted(self, shop: dict) -> None:
        invoice = _sale(shop, [{"method": "CREDIT", "amount": Decimal("1000.00")}])
        assert invoice.due_amount == Decimal("1000.00")
        assert invoice.paid_amount == Decimal("0")

    def test_mismatched_credit_tender_rejected(self, shop: dict) -> None:
        """CREDIT 500 against a computed due of 700 must not silently pass."""
        with pytest.raises(ServiceError) as exc:
            _sale(
                shop,
                [
                    {"method": "CASH", "amount": Decimal("300.00")},
                    {"method": "CREDIT", "amount": Decimal("500.00")},
                ],
            )
        assert exc.value.code == "CREDIT_TENDER_MISMATCH"

    def test_implicit_due_without_credit_tender_still_allowed(self, shop: dict) -> None:
        invoice = _sale(shop, [{"method": "CASH", "amount": Decimal("300.00")}])
        assert invoice.due_amount == Decimal("700.00")

    def test_outstanding_counts_the_credit_due(self, shop: dict) -> None:
        _sale(
            shop,
            [
                {"method": "CASH", "amount": Decimal("300.00")},
                {"method": "CREDIT", "amount": Decimal("700.00")},
            ],
        )
        # Canonical selector counts due_amount as udharo.
        assert customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("700.00")
