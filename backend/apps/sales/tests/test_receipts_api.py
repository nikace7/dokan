"""Receipt-print API tests."""

from typing import Any

import pytest

from apps.audit.models import AuditLog
from apps.sales.tests.test_sales_api import SALES_URL, auth_client, grant, host
from tests.factories import (
    BranchFactory,
    SalesInvoiceFactory,
    SalesInvoiceItemFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug="shreeganesh")


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


class TestReceiptPrinting:
    def test_completed_receipt_prints_are_immutable_audit_events(
        self, tenant: Any, user: Any
    ) -> None:
        invoice = SalesInvoiceFactory(tenant=tenant, status="COMPLETED", print_count=0)
        grant(tenant, user, "sale.create", "sale.view")
        client = auth_client(user)
        url = f"{SALES_URL}/{invoice.pk}/print"

        first = client.post(url, {}, **host(), format="json")
        second = client.post(url, {}, **host(), format="json")

        assert first.status_code == second.status_code == 200
        assert first.json()["data"] == {"id": str(invoice.pk), "print_count": 1}
        assert second.json()["data"] == {"id": str(invoice.pk), "print_count": 2}
        invoice.refresh_from_db()
        assert invoice.print_count == 0
        assert (
            AuditLog.objects.filter(
                tenant=tenant,
                action="sale.receipt.print",
                target_type="sales_invoice",
                target_id=invoice.pk,
            ).count()
            == 2
        )

        detail = client.get(f"{SALES_URL}/{invoice.pk}", **host())
        assert detail.json()["data"]["print_count"] == 2
        listing = client.get(SALES_URL, **host())
        printed = next(row for row in listing.json()["data"] if row["id"] == str(invoice.pk))
        assert printed["print_count"] == 2

    def test_only_completed_receipts_are_printable(self, tenant: Any, user: Any) -> None:
        invoice = SalesInvoiceFactory(tenant=tenant, status="HELD")
        grant(tenant, user, "sale.create")

        response = auth_client(user).post(
            f"{SALES_URL}/{invoice.pk}/print", {}, **host(), format="json"
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "RECEIPT_NOT_PRINTABLE"
        assert not AuditLog.objects.filter(tenant=tenant, target_id=invoice.pk).exists()

    def test_print_requires_sale_create(self, tenant: Any, user: Any) -> None:
        invoice = SalesInvoiceFactory(tenant=tenant, status="COMPLETED")
        grant(tenant, user, "sale.view")

        response = auth_client(user).post(
            f"{SALES_URL}/{invoice.pk}/print", {}, **host(), format="json"
        )

        assert response.status_code == 403

    def test_receipt_shape_contains_shop_branch_and_tender_details(
        self, tenant: Any, user: Any
    ) -> None:
        tenant.name = "Shree Ganesh"
        tenant.name_np = "श्री गणेश"
        tenant.legal_name = "Shree Ganesh Traders Pvt. Ltd."
        tenant.pan_vat_no = "123456789"
        tenant.vat_registered = True
        tenant.save()
        branch = BranchFactory(
            tenant=tenant,
            name="New Road",
            name_np="नयाँ सडक",
            address="Kathmandu",
            phone="01-5550000",
        )
        invoice = SalesInvoiceFactory(
            tenant=tenant,
            branch=branch,
            status="COMPLETED",
            tenders=[{"method": "CASH", "amount": "1000.00"}],
        )
        SalesInvoiceItemFactory(tenant=tenant, invoice=invoice)
        grant(tenant, user, "sale.view")

        response = auth_client(user).get(f"{SALES_URL}/{invoice.pk}", **host())

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["tenant_name"] == "Shree Ganesh"
        assert data["tenant_name_np"] == "श्री गणेश"
        assert data["legal_name"] == "Shree Ganesh Traders Pvt. Ltd."
        assert data["pan_vat_no"] == "123456789"
        assert data["vat_registered"] is True
        assert data["branch_name"] == "New Road"
        assert data["invoice_prefix"] == branch.invoice_prefix
        assert data["branch_name_np"] == "नयाँ सडक"
        assert data["branch_address"] == "Kathmandu"
        assert data["branch_phone"] == "01-5550000"
        assert data["tenders"] == [{"method": "CASH", "amount": "1000.00"}]
