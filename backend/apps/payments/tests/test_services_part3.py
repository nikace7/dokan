"""Payments service tests — allocation math, canonical outstanding, aging,
ledgers, and the append-only enforcement. Money-critical: 100% coverage.
"""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from apps.inventory.services import post_opening_stock
from apps.payments import services
from apps.payments.models import Payment
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


def _sale(shop: dict, paid: str, key: str, **kwargs: Any) -> Any:
    """A completed 1000-rupee sale with `paid` cash — the rest is due."""
    paid_amount = Decimal(paid)
    return sale_services.create_sale(
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
        payments=[{"method": "CASH", "amount": paid_amount}] if paid_amount > 0 else [],
        idempotency_key=key,
        created_by=shop["user"],
        **kwargs,
    ).invoice


def _receipt(shop: dict, amount: str, key: str = "rcpt-1", **kwargs: Any) -> Any:
    return services.record_receipt(
        shop["tenant"],
        branch=shop["branch"],
        customer=shop["customer"],
        amount=Decimal(amount),
        method="CASH",
        idempotency_key=key,
        created_by=shop["user"],
        **kwargs,
    )


class TestPurchaseAllocationBranches:
    def _confirmed_purchase(self, shop: dict, supplier: Any, key: str = "pi-1") -> Any:
        from apps.purchasing import services as purchase_services

        invoice = purchase_services.create_purchase_invoice(
            shop["tenant"],
            branch=shop["branch"],
            supplier=supplier,
            bill_date_ad=date(2026, 1, 15),
            is_vat_bill=False,
            other_charges=Decimal("0"),
            paid_amount=Decimal("0"),
            note="",
            lines=[
                {
                    "variant": shop["variant"],
                    "qty": Decimal("1"),
                    "unit_cost": Decimal("1000.00"),
                    "discount": Decimal("0"),
                }
            ],
            created_by=shop["user"],
        )
        return purchase_services.confirm_purchase_invoice(
            shop["tenant"], invoice=invoice, created_by=shop["user"]
        )

    def test_zero_purchase_allocation_rejected(self, shop: dict) -> None:
        supplier = SupplierFactory(tenant=shop["tenant"])
        invoice = self._confirmed_purchase(shop, supplier)
        with pytest.raises(ServiceError) as exc:
            services.record_payment(
                shop["tenant"],
                branch=shop["branch"],
                supplier=supplier,
                amount=Decimal("100.00"),
                method="CASH",
                allocations=[{"purchase_invoice": invoice, "amount": Decimal("0")}],
                idempotency_key="pay-zero",
                created_by=shop["user"],
            )
        assert exc.value.code == "ALLOCATION_AMOUNT_INVALID"

    def test_wrong_supplier_invoice_rejected(self, shop: dict) -> None:
        supplier = SupplierFactory(tenant=shop["tenant"])
        other = SupplierFactory(tenant=shop["tenant"])
        invoice = self._confirmed_purchase(shop, supplier)
        with pytest.raises(ServiceError) as exc:
            services.record_payment(
                shop["tenant"],
                branch=shop["branch"],
                supplier=other,
                amount=Decimal("100.00"),
                method="CASH",
                allocations=[{"purchase_invoice": invoice, "amount": Decimal("100.00")}],
                idempotency_key="pay-wrong",
                created_by=shop["user"],
            )
        assert exc.value.code == "ALLOCATION_INVOICE_INVALID"

    def test_allocations_above_payment_rejected(self, shop: dict) -> None:
        supplier = SupplierFactory(tenant=shop["tenant"])
        invoice = self._confirmed_purchase(shop, supplier)
        with pytest.raises(ServiceError) as exc:
            services.record_payment(
                shop["tenant"],
                branch=shop["branch"],
                supplier=supplier,
                amount=Decimal("100.00"),
                method="CASH",
                allocations=[{"purchase_invoice": invoice, "amount": Decimal("200.00")}],
                idempotency_key="pay-above",
                created_by=shop["user"],
            )
        assert exc.value.code == "ALLOCATION_EXCEEDS_AMOUNT"

    def test_supplier_payment_replay_returns_original(self, shop: dict) -> None:
        supplier = SupplierFactory(tenant=shop["tenant"])
        kwargs: dict[str, Any] = {
            "branch": shop["branch"],
            "supplier": supplier,
            "amount": Decimal("100.00"),
            "method": "CASH",
            "idempotency_key": "pay-replay",
            "created_by": shop["user"],
        }
        first = services.record_payment(shop["tenant"], **kwargs)
        second = services.record_payment(shop["tenant"], **kwargs)
        assert second.replayed is True
        assert second.payment.pk == first.payment.pk
        assert Payment.objects.filter(tenant=shop["tenant"]).count() == 1


class TestIntegrityErrorReraise:
    def test_receipt_non_idempotency_integrity_error_reraises(
        self, shop: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from django.db import IntegrityError

        def broken_save(self: Any, **kwargs: Any) -> None:
            raise IntegrityError("some unrelated database error")

        monkeypatch.setattr(Payment, "save", broken_save)
        with pytest.raises(IntegrityError, match="unrelated"):
            _receipt(shop, "100.00", key="rcpt-reraise")

    def test_supplier_payment_non_idempotency_integrity_error_reraises(
        self, shop: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from django.db import IntegrityError

        def broken_save(self: Any, **kwargs: Any) -> None:
            raise IntegrityError("some unrelated database error")

        monkeypatch.setattr(Payment, "save", broken_save)
        with pytest.raises(IntegrityError, match="unrelated"):
            services.record_payment(
                shop["tenant"],
                branch=shop["branch"],
                supplier=SupplierFactory(tenant=shop["tenant"]),
                amount=Decimal("100.00"),
                method="CASH",
                idempotency_key="pay-reraise",
                created_by=shop["user"],
            )
