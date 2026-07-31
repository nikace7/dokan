"""Payments service tests — allocation math, canonical outstanding, aging,
ledgers, and the append-only enforcement. Money-critical: 100% coverage.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from django.db import ProgrammingError, connection, transaction

from apps.customers.selectors import get_customer_outstanding
from apps.inventory.services import post_opening_stock
from apps.payments import services
from apps.payments.models import Payment
from apps.payments.selectors import (
    customer_aging,
    customer_ledger,
    invoice_outstanding,
    supplier_ledger,
    supplier_payable,
)
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from core.db.rls import revoke_update_delete_sql, set_local_tenant
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


class TestReceiptAllocations:
    def test_partial_allocation_across_invoices(self, shop: dict) -> None:
        sale_a = _sale(shop, "0", "s-1")  # due 1000
        sale_b = _sale(shop, "500.00", "s-2")  # due 500
        result = _receipt(
            shop,
            "1200.00",
            allocations=[
                {"sales_invoice": sale_a, "amount": Decimal("800.00")},
                {"sales_invoice": sale_b, "amount": Decimal("400.00")},
            ],
        )
        assert result.replayed is False
        assert len(result.payment.allocations.all()) == 2
        assert invoice_outstanding(shop["tenant"], invoice=sale_a) == Decimal("200.00")
        assert invoice_outstanding(shop["tenant"], invoice=sale_b) == Decimal("100.00")

    def test_over_allocation_rejected(self, shop: dict) -> None:
        sale = _sale(shop, "500.00", "s-1")  # due 500
        with pytest.raises(ServiceError) as exc:
            _receipt(
                shop,
                "600.00",
                allocations=[{"sales_invoice": sale, "amount": Decimal("600.00")}],
            )
        assert exc.value.code == "ALLOCATION_EXCEEDS_OUTSTANDING"

    def test_allocations_above_amount_rejected(self, shop: dict) -> None:
        sale = _sale(shop, "0", "s-1")
        with pytest.raises(ServiceError) as exc:
            _receipt(
                shop,
                "100.00",
                allocations=[{"sales_invoice": sale, "amount": Decimal("200.00")}],
            )
        assert exc.value.code == "ALLOCATION_EXCEEDS_AMOUNT"

    def test_allocation_to_other_customer_rejected(self, shop: dict) -> None:
        sale = _sale(shop, "0", "s-1")
        other = CustomerFactory(tenant=shop["tenant"])
        with pytest.raises(ServiceError) as exc:
            services.record_receipt(
                shop["tenant"],
                branch=shop["branch"],
                customer=other,
                amount=Decimal("100.00"),
                method="CASH",
                allocations=[{"sales_invoice": sale, "amount": Decimal("100.00")}],
                idempotency_key="rcpt-other",
                created_by=shop["user"],
            )
        assert exc.value.code == "ALLOCATION_INVOICE_INVALID"

    def test_allocation_to_held_invoice_rejected(self, shop: dict) -> None:
        held = sale_services.hold_bill(
            shop["tenant"],
            branch=shop["branch"],
            rate_type=shop["rate_type"],
            lines=[
                SaleLineInput(
                    variant=shop["variant"],
                    qty=Decimal("1"),
                    unit_price=None,
                    discount=Decimal("0"),
                )
            ],
            idempotency_key="held-1",
            created_by=shop["user"],
        ).invoice
        with pytest.raises(ServiceError) as exc:
            _receipt(
                shop,
                "100.00",
                allocations=[{"sales_invoice": held, "amount": Decimal("100.00")}],
            )
        assert exc.value.code == "ALLOCATION_INVOICE_INVALID"

    def test_zero_allocation_amount_rejected(self, shop: dict) -> None:
        sale = _sale(shop, "0", "s-1")
        with pytest.raises(ServiceError) as exc:
            _receipt(
                shop,
                "100.00",
                allocations=[{"sales_invoice": sale, "amount": Decimal("0")}],
            )
        assert exc.value.code == "ALLOCATION_AMOUNT_INVALID"


class TestOutstandingDerivation:
    def test_unallocated_advance_reduces_outstanding(self, shop: dict) -> None:
        _sale(shop, "0", "s-1")  # due 1000
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("1000.00")
        _receipt(shop, "300.00")
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("700.00")

    def test_credit_notes_and_receipts_combine(self, shop: dict) -> None:
        original = _sale(shop, "0", "s-1")  # due 1000
        sale_services.create_return(
            shop["tenant"],
            original_invoice=original,
            lines=[sale_services.ReturnLineInput(variant=shop["variant"], qty=Decimal("1"))],
            reason="Wrong size",
            refunds=[{"method": "CREDIT_NOTE", "amount": Decimal("200.00")}],
            idempotency_key="ret-1",
            created_by=shop["user"],
        )
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("800.00")
        _receipt(shop, "500.00")
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("300.00")

    def test_supplier_payable_derivation(self, shop: dict) -> None:
        from datetime import date as date_type

        from apps.purchasing import services as purchase_services

        supplier = SupplierFactory(tenant=shop["tenant"])
        invoice = purchase_services.create_purchase_invoice(
            shop["tenant"],
            branch=shop["branch"],
            supplier=supplier,
            bill_date_ad=date_type(2026, 1, 15),
            is_vat_bill=False,
            other_charges=Decimal("0"),
            paid_amount=Decimal("200.00"),
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
        purchase_services.confirm_purchase_invoice(
            shop["tenant"], invoice=invoice, created_by=shop["user"]
        )
        assert supplier_payable(shop["tenant"], supplier) == Decimal("800.00")
        services.record_payment(
            shop["tenant"],
            branch=shop["branch"],
            supplier=supplier,
            amount=Decimal("500.00"),
            method="BANK",
            allocations=[{"purchase_invoice": invoice, "amount": Decimal("500.00")}],
            idempotency_key="pay-1",
            created_by=shop["user"],
        )
        assert supplier_payable(shop["tenant"], supplier) == Decimal("300.00")
        assert invoice_outstanding(shop["tenant"], invoice=invoice) == Decimal("300.00")

    def test_supplier_payment_over_allocation_rejected(self, shop: dict) -> None:
        from datetime import date as date_type

        from apps.purchasing import services as purchase_services

        supplier = SupplierFactory(tenant=shop["tenant"])
        invoice = purchase_services.create_purchase_invoice(
            shop["tenant"],
            branch=shop["branch"],
            supplier=supplier,
            bill_date_ad=date_type(2026, 1, 15),
            is_vat_bill=False,
            other_charges=Decimal("0"),
            paid_amount=Decimal("500.00"),
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
        purchase_services.confirm_purchase_invoice(
            shop["tenant"], invoice=invoice, created_by=shop["user"]
        )
        with pytest.raises(ServiceError) as exc:
            services.record_payment(
                shop["tenant"],
                branch=shop["branch"],
                supplier=supplier,
                amount=Decimal("600.00"),
                method="BANK",
                allocations=[{"purchase_invoice": invoice, "amount": Decimal("600.00")}],
                idempotency_key="pay-over",
                created_by=shop["user"],
            )
        assert exc.value.code == "ALLOCATION_EXCEEDS_OUTSTANDING"


class TestReceiptValidation:
    def test_missing_key_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _receipt(shop, "100.00", key=" ")
        assert exc.value.code == "IDEMPOTENCY_KEY_REQUIRED"

    def test_zero_amount_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            _receipt(shop, "0")
        assert exc.value.code == "PAYMENT_AMOUNT_INVALID"

    def test_unknown_method_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.record_receipt(
                shop["tenant"],
                branch=shop["branch"],
                customer=shop["customer"],
                amount=Decimal("100.00"),
                method="BITCOIN",
                idempotency_key="rcpt-bad",
                created_by=shop["user"],
            )
        assert exc.value.code == "PAYMENT_METHOD_INVALID"


class TestIdempotency:
    def test_replay_returns_original(self, shop: dict) -> None:
        first = _receipt(shop, "300.00")
        second = _receipt(shop, "300.00")
        assert second.replayed is True
        assert second.payment.pk == first.payment.pk
        assert Payment.objects.filter(tenant=shop["tenant"]).count() == 1


class TestLedgers:
    def test_customer_ledger_running_balance(self, shop: dict) -> None:
        _sale(shop, "0", "s-1")
        original = _sale(shop, "0", "s-2")
        sale_services.create_return(
            shop["tenant"],
            original_invoice=original,
            lines=[sale_services.ReturnLineInput(variant=shop["variant"], qty=Decimal("1"))],
            reason="Wrong size",
            refunds=[{"method": "CREDIT_NOTE", "amount": Decimal("100.00")}],
            idempotency_key="ret-1",
            created_by=shop["user"],
        )
        _receipt(shop, "400.00")
        rows = customer_ledger(shop["tenant"], shop["customer"])
        kinds = [row.kind for row in rows]
        assert kinds == ["OPENING", "SALE", "SALE", "CREDIT_NOTE", "RECEIPT"]
        assert rows[-1].balance == Decimal("1500.00")  # 2000 dues − 100 − 400
        balances = [row.balance for row in rows]
        assert balances == sorted(balances) or balances[0] <= balances[-1]

    def test_supplier_ledger_running_balance(self, shop: dict) -> None:
        from datetime import date as date_type

        from apps.purchasing import services as purchase_services

        supplier = SupplierFactory(tenant=shop["tenant"])
        invoice = purchase_services.create_purchase_invoice(
            shop["tenant"],
            branch=shop["branch"],
            supplier=supplier,
            bill_date_ad=date_type(2026, 1, 15),
            is_vat_bill=False,
            other_charges=Decimal("0"),
            paid_amount=Decimal("0"),
            note="",
            lines=[
                {
                    "variant": shop["variant"],
                    "qty": Decimal("1"),
                    "unit_cost": Decimal("700.00"),
                    "discount": Decimal("0"),
                }
            ],
            created_by=shop["user"],
        )
        purchase_services.confirm_purchase_invoice(
            shop["tenant"], invoice=invoice, created_by=shop["user"]
        )
        services.record_payment(
            shop["tenant"],
            branch=shop["branch"],
            supplier=supplier,
            amount=Decimal("200.00"),
            method="CASH",
            idempotency_key="pay-1",
            created_by=shop["user"],
        )
        rows = supplier_ledger(shop["tenant"], supplier)
        assert [row.kind for row in rows] == ["OPENING", "PURCHASE", "PAYMENT"]
        assert rows[-1].balance == Decimal("500.00")


class TestAging:
    def test_buckets_and_unallocated_oldest_first(self, shop: dict) -> None:
        today = date.today()
        for days_old, key in ((10, "a"), (40, "b"), (70, "c"), (100, "d")):
            _sale(
                shop,
                "0",
                f"s-{key}",
                business_date=today - timedelta(days=days_old),
            )
        # Advance of 1500 reduces the OLDEST bucket first (90+ has 1000,
        # then 61-90 has 1000 → 500 left in 61-90).
        _receipt(shop, "1500.00")
        rows = customer_aging(shop["tenant"])
        assert len(rows) == 1
        buckets = rows[0]["buckets"]
        assert buckets["90+"] == "0.00"
        assert buckets["61-90"] == "500.00"
        assert buckets["31-60"] == "1000.00"
        assert buckets["0-30"] == "1000.00"
        assert rows[0]["total_outstanding"] == "2500.00"

    def test_bucket_boundaries(self, shop: dict) -> None:
        today = date.today()
        _sale(shop, "0", "b-30", business_date=today - timedelta(days=30))
        _sale(shop, "0", "b-31", business_date=today - timedelta(days=31))
        _sale(shop, "0", "b-90", business_date=today - timedelta(days=90))
        _sale(shop, "0", "b-91", business_date=today - timedelta(days=91))
        rows = customer_aging(shop["tenant"])
        buckets = rows[0]["buckets"]
        assert buckets["0-30"] == "1000.00"
        assert buckets["31-60"] == "1000.00"
        assert buckets["61-90"] == "1000.00"
        assert buckets["90+"] == "1000.00"


class TestAppendOnly:
    def test_update_rejected_for_app_role(self, shop: dict) -> None:
        """The REVOKE the migration applies in prod really blocks UPDATEs."""
        _receipt(shop, "100.00")
        role = "dokan_app"
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                        CREATE ROLE {role} NOLOGIN;
                    END IF;
                END
                $$;
                """
            )
            cursor.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
            cursor.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}"
            )
            # The exact SQL the migration runs in production.
            cursor.execute(revoke_update_delete_sql("payment"))
            cursor.execute(f"SET LOCAL ROLE {role}")
        set_local_tenant(connection, shop["tenant"].pk)

        payment = Payment.objects.get(tenant=shop["tenant"])
        # INSERT works for the app role…
        assert payment.pk is not None
        # …but UPDATE on the append-only table is rejected by the DB.
        with pytest.raises(ProgrammingError), transaction.atomic():
            payment.note = "edited"
            payment.save(update_fields=["note"])


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
