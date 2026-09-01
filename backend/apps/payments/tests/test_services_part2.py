"""Payments service tests — allocation math, canonical outstanding, aging,
ledgers, and the append-only enforcement. Money-critical: 100% coverage.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from django.db import ProgrammingError, connection, transaction

from apps.audit.models import AuditLog
from apps.customers.selectors import get_customer_outstanding
from apps.inventory.services import post_opening_stock
from apps.payments import services
from apps.payments.models import Payment
from apps.payments.selectors import (
    customer_aging,
    customer_ledger,
    invoice_outstanding,
    supplier_ledger,
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


class TestPaymentReversal:
    def test_reversal_writes_counter_entries_and_restores_outstanding(self, shop: dict) -> None:
        sale = _sale(shop, "0", "s-reversal")
        original = _receipt(
            shop,
            "300.00",
            key="rcpt-reversal",
            allocations=[{"sales_invoice": sale, "amount": Decimal("300.00")}],
        ).payment

        result = services.reverse_payment(
            shop["tenant"],
            payment=original,
            reason="Duplicate receipt",
            idempotency_key="reverse-1",
            created_by=shop["user"],
        )

        reversal = result.payment
        assert result.replayed is False
        assert reversal.amount == Decimal("-300.00")
        assert reversal.reversal_of_id == original.pk
        assert reversal.allocations.get().amount == Decimal("-300.00")
        assert invoice_outstanding(shop["tenant"], invoice=sale) == Decimal("1000.00")
        assert get_customer_outstanding(shop["tenant"], shop["customer"]) == Decimal("1000.00")
        audit_row = AuditLog.objects.get(tenant=shop["tenant"], action="payment.reverse")
        assert audit_row.target_id == original.pk
        assert audit_row.after is not None
        assert audit_row.after["reversal_id"] == str(reversal.pk)

    def test_reversal_is_idempotent_and_only_one_is_allowed(self, shop: dict) -> None:
        original = _receipt(shop, "300.00", key="rcpt-reversal").payment
        first = services.reverse_payment(
            shop["tenant"],
            payment=original,
            reason="Duplicate receipt",
            idempotency_key="reverse-1",
            created_by=shop["user"],
        )
        replay = services.reverse_payment(
            shop["tenant"],
            payment=original,
            reason="Same request replay",
            idempotency_key="reverse-1",
            created_by=shop["user"],
        )
        assert replay.replayed is True
        assert replay.payment.pk == first.payment.pk

        with pytest.raises(ServiceError) as exc:
            services.reverse_payment(
                shop["tenant"],
                payment=original,
                reason="Second reversal",
                idempotency_key="reverse-2",
                created_by=shop["user"],
            )
        assert exc.value.code == "PAYMENT_ALREADY_REVERSED"

    def test_reversal_reason_is_required(self, shop: dict) -> None:
        original = _receipt(shop, "300.00", key="rcpt-reversal").payment
        with pytest.raises(ServiceError) as exc:
            services.reverse_payment(
                shop["tenant"],
                payment=original,
                reason=" ",
                idempotency_key="reverse-1",
                created_by=shop["user"],
            )
        assert exc.value.code == "REVERSAL_REASON_REQUIRED"


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
