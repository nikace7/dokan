"""Compliance tests — queue wiring, payload snapshot, retry behavior, API."""

from decimal import Decimal
from typing import Any

import pytest
from celery.exceptions import Retry
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.compliance import services
from apps.compliance.models import CbmsSyncLog
from apps.compliance.providers.base import CbmsProviderError
from apps.compliance.providers.local import SUBMITTED_PAYLOADS
from apps.compliance.tasks import _mark_failed, _record_attempt, sync_cbms_invoice
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from core.responses import ServiceError
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    CbmsSyncLogFactory,
    CustomerFactory,
    ItemFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    SalesInvoiceFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"


@pytest.fixture(autouse=True)
def _clear_local_sink() -> Any:
    SUBMITTED_PAYLOADS.clear()
    yield
    SUBMITTED_PAYLOADS.clear()


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory(slug=SLUG, vat_registered=True)
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(
        tenant=tenant,
        item=ItemFactory(tenant=tenant, is_vat_applicable=True),
        mrp=Decimal("1000.00"),
    )
    from apps.inventory.services import post_opening_stock

    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("20"),
        unit_cost=Decimal("600.00"),
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


def _sale(shop: dict, key: str = "s-1") -> Any:
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
        payments=[{"method": "CASH", "amount": Decimal("1130.00")}],
        is_vat_bill=True,
        idempotency_key=key,
        created_by=shop["user"],
    ).invoice


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str = SLUG) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **host(slug),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


class TestEnqueueWiring:
    def test_completed_sale_syncs_via_local_provider(self, shop: dict) -> None:
        invoice = _sale(shop)
        row = CbmsSyncLog.objects.get(tenant=shop["tenant"], invoice=invoice)
        assert row.status == CbmsSyncLog.Status.SYNCED
        assert row.synced_at is not None
        # Frozen payload snapshot with the IRD-required content.
        payload = row.payload
        assert payload["invoice_no"].endswith("-000001")
        assert payload["doc_type"] == "SALE"
        assert payload["is_vat_bill"] is True
        assert payload["vat_amount"] == "130.00"
        assert payload["total"] == "1130.00"
        assert payload["lines"][0]["sku"] == shop["variant"].sku
        assert len(SUBMITTED_PAYLOADS) == 1  # local provider recorded it

    def test_return_is_enqueued_with_original_reference(self, shop: dict) -> None:
        original = _sale(shop)
        sale_services.create_return(
            shop["tenant"],
            original_invoice=original,
            lines=[sale_services.ReturnLineInput(variant=shop["variant"], qty=Decimal("1"))],
            reason="Wrong size",
            refunds=[{"method": "CASH", "amount": Decimal("1130.00")}],
            idempotency_key="ret-1",
            created_by=shop["user"],
        )
        rows = CbmsSyncLog.objects.filter(tenant=shop["tenant"])
        assert rows.count() == 2
        return_row = rows.get(invoice__doc_type="RETURN")
        assert return_row.status == CbmsSyncLog.Status.SYNCED
        assert return_row.payload["original_invoice_no"].endswith("-000001")

    def test_held_completion_enqueues(self, shop: dict) -> None:
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
            is_vat_bill=True,
            idempotency_key="hold-1",
            created_by=shop["user"],
        ).invoice
        assert not CbmsSyncLog.objects.filter(invoice=held).exists()  # HELD: no row
        sale_services.complete_held_bill(
            shop["tenant"],
            invoice=held,
            payments=[{"method": "CASH", "amount": Decimal("1130.00")}],
            created_by=shop["user"],
        )
        assert CbmsSyncLog.objects.get(invoice=held).status == CbmsSyncLog.Status.SYNCED

    def test_double_enqueue_is_idempotent(self, shop: dict) -> None:
        invoice = _sale(shop)
        again = services.enqueue_for_sync(shop["tenant"], invoice=invoice)
        assert CbmsSyncLog.objects.filter(invoice=invoice).count() == 1
        assert again.status == CbmsSyncLog.Status.SYNCED  # not reset, not redispatched
        assert len(SUBMITTED_PAYLOADS) == 1

    def test_held_invoice_rejected(self, shop: dict) -> None:
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
            idempotency_key="hold-2",
            created_by=shop["user"],
        ).invoice
        with pytest.raises(ServiceError) as exc:
            services.enqueue_for_sync(shop["tenant"], invoice=held)
        assert exc.value.code == "CBMS_NOT_COMPLETED"


class TestRetryBehavior:
    def test_retryable_error_keeps_pending_and_retries(self, shop: dict, monkeypatch: Any) -> None:
        row = CbmsSyncLogFactory(tenant=shop["tenant"])

        class FlakyClient:
            name = "flaky"

            def submit_invoice(self, payload: Any) -> str:
                raise CbmsProviderError("CBMS timeout", retryable=True)

        monkeypatch.setattr("apps.compliance.tasks.get_cbms_client", lambda: FlakyClient())
        with pytest.raises(Retry):
            sync_cbms_invoice.apply(args=[str(shop["tenant"].pk), str(row.pk)], throw=True)
        row.refresh_from_db()
        assert row.status == CbmsSyncLog.Status.PENDING
        assert row.attempts == 1
        assert "timeout" in row.last_error

    def test_non_retryable_error_marks_failed_immediately(
        self, shop: dict, monkeypatch: Any
    ) -> None:
        row = CbmsSyncLogFactory(tenant=shop["tenant"])

        class RejectingClient:
            name = "rejecting"

            def submit_invoice(self, payload: Any) -> str:
                raise CbmsProviderError("schema rejected", retryable=False)

        monkeypatch.setattr("apps.compliance.tasks.get_cbms_client", lambda: RejectingClient())
        sync_cbms_invoice.apply(args=[str(shop["tenant"].pk), str(row.pk)], throw=True)
        row.refresh_from_db()
        assert row.status == CbmsSyncLog.Status.FAILED
        assert row.attempts == 1
        assert row.last_error == "schema rejected"

    def test_mark_failed_and_record_attempt_helpers(self, shop: dict) -> None:
        row = CbmsSyncLogFactory(tenant=shop["tenant"])
        _record_attempt(str(shop["tenant"].pk), str(row.pk), "boom", retries=3)
        row.refresh_from_db()
        assert row.attempts == 3 and row.last_error == "boom"
        _mark_failed(str(shop["tenant"].pk), str(row.pk), "final boom", retries=5)
        row.refresh_from_db()
        assert row.status == CbmsSyncLog.Status.FAILED
        assert row.attempts == 5

    def test_helpers_skip_non_pending_rows(self, shop: dict) -> None:
        row = CbmsSyncLogFactory(tenant=shop["tenant"], status=CbmsSyncLog.Status.SYNCED)
        _record_attempt(str(shop["tenant"].pk), str(row.pk), "late failure", retries=2)
        _mark_failed(str(shop["tenant"].pk), str(row.pk), "late failure", retries=2)
        row.refresh_from_db()
        assert row.status == CbmsSyncLog.Status.SYNCED  # untouched by stale deliveries


class TestApi:
    def test_unauthenticated_is_401(self, shop: dict) -> None:
        import uuid

        assert (
            APIClient().get(f"/api/v1/compliance/status/{uuid.uuid4()}", **host()).status_code
            == 401
        )

    def test_status_endpoint_shows_synced(self, shop: dict) -> None:
        invoice = _sale(shop)
        grant(shop["tenant"], shop["user"], "sale.view")
        response = auth_client(shop["user"]).get(
            f"/api/v1/compliance/status/{invoice.pk}", **host()
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "SYNCED"
        assert data["synced_at"] is not None

    def test_status_not_queued_for_unenqueued_invoice(self, shop: dict) -> None:
        invoice = SalesInvoiceFactory(tenant=shop["tenant"])
        grant(shop["tenant"], shop["user"], "sale.view")
        response = auth_client(shop["user"]).get(
            f"/api/v1/compliance/status/{invoice.pk}", **host()
        )
        assert response.json()["data"]["status"] == "NOT_QUEUED"

    def test_status_unknown_invoice_is_404(self, shop: dict) -> None:
        import uuid

        grant(shop["tenant"], shop["user"], "sale.view")
        response = auth_client(shop["user"]).get(
            f"/api/v1/compliance/status/{uuid.uuid4()}", **host()
        )
        assert response.status_code == 404

    def test_failures_require_compliance_view(self, shop: dict) -> None:
        grant(shop["tenant"], shop["user"], "sale.view")
        response = auth_client(shop["user"]).get("/api/v1/compliance/failures", **host())
        assert response.status_code == 403

    def test_failures_list_shows_failed_with_payload(self, shop: dict) -> None:
        row = CbmsSyncLogFactory(
            tenant=shop["tenant"],
            status=CbmsSyncLog.Status.FAILED,
            attempts=5,
            last_error="schema rejected",
        )
        CbmsSyncLogFactory(tenant=shop["tenant"])  # PENDING — must not appear
        grant(shop["tenant"], shop["user"], "compliance.view")
        response = auth_client(shop["user"]).get("/api/v1/compliance/failures", **host())
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data) == 1
        assert data[0]["id"] == str(row.pk)
        assert data[0]["payload"]["invoice_no"] == "INV-2082-83-000001"
        assert data[0]["last_error"] == "schema rejected"
