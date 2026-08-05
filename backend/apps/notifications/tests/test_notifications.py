"""SMS receipt queue, provider delivery, and tenant API tests."""

from decimal import Decimal
from typing import Any
from unittest.mock import Mock, patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.notifications.models import SmsLog
from apps.notifications.providers.base import ProviderError, ProviderReceipt
from apps.notifications.services import queue_receipt_sms
from apps.notifications.tasks import send_sms
from apps.sales.models import SalesInvoice
from core.responses import ServiceError
from tests.factories import (
    DEFAULT_PASSWORD,
    CustomerFactory,
    RoleFactory,
    RolePermissionFactory,
    SalesInvoiceFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
LIST_URL = "/api/v1/notifications/sms"
RECEIPT_URL = "/api/v1/notifications/sms/receipt"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **host(),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory(slug=SLUG, name="Shree Ganesh Fashion")
    user = UserFactory(tenant=tenant)
    customer = CustomerFactory(tenant=tenant, phone="9800000001")
    invoice = SalesInvoiceFactory(
        tenant=tenant,
        customer=customer,
        invoice_no=7,
        total=Decimal("1250.00"),
        paid_amount=Decimal("1000.00"),
        due_amount=Decimal("250.00"),
    )
    return {"tenant": tenant, "user": user, "customer": customer, "invoice": invoice}


class TestReceiptQueue:
    def test_sms_quota_hard_blocks_new_message(self, shop: dict[str, Any]) -> None:
        shop["tenant"].plan.limits = {"sms_credits_per_month": 1}
        shop["tenant"].plan.save(update_fields=["limits"])
        SmsLog.objects.create(
            tenant=shop["tenant"],
            to_phone="9779800000001",
            template="receipt",
            body="Existing message",
        )

        with pytest.raises(ServiceError) as exc_info:
            queue_receipt_sms(shop["tenant"], invoice=shop["invoice"])

        assert exc_info.value.code == "PLAN_LIMIT_REACHED"
        assert exc_info.value.http_status == 402

    def test_queues_template_and_dispatches_after_commit(
        self, shop: dict[str, Any], django_capture_on_commit_callbacks: Any
    ) -> None:
        with (
            patch("apps.notifications.tasks.send_sms.delay") as delay,
            django_capture_on_commit_callbacks(execute=True),
        ):
            row = queue_receipt_sms(shop["tenant"], invoice=shop["invoice"])

        assert row.status == SmsLog.Status.QUEUED
        assert row.to_phone == "9779800000001"
        assert row.template == "receipt"
        assert "Shree Ganesh Fashion" in row.body
        assert "INV-" in row.body
        assert "NPR 1250.00" in row.body
        assert "due NPR 250.00" in row.body
        delay.assert_called_once_with(str(shop["tenant"].pk), str(row.pk))

    def test_explicit_phone_is_normalized(self, shop: dict[str, Any]) -> None:
        with patch("apps.notifications.tasks.send_sms.delay"):
            row = queue_receipt_sms(
                shop["tenant"], invoice=shop["invoice"], to_phone="+977 981-234-5678"
            )
        assert row.to_phone == "9779812345678"

    @pytest.mark.parametrize("phone", ["", "12345", "+977-01-5555555"])
    def test_rejects_invalid_phone(self, shop: dict[str, Any], phone: str) -> None:
        with pytest.raises(ServiceError) as exc_info:
            queue_receipt_sms(shop["tenant"], invoice=shop["invoice"], to_phone=phone)
        assert exc_info.value.code == "SMS_PHONE_INVALID"

    def test_rejects_non_completed_invoice(self, shop: dict[str, Any]) -> None:
        shop["invoice"].status = SalesInvoice.Status.HELD
        shop["invoice"].save(update_fields=["status"])
        with pytest.raises(ServiceError) as exc_info:
            queue_receipt_sms(shop["tenant"], invoice=shop["invoice"])
        assert exc_info.value.code == "SMS_RECEIPT_NOT_ALLOWED"


class TestDeliveryTask:
    def test_sends_once_and_records_provider_receipt(self, shop: dict[str, Any]) -> None:
        row = SmsLog.objects.create(
            tenant=shop["tenant"],
            to_phone="9779800000001",
            template="receipt",
            body="Receipt body",
        )
        provider = Mock()
        provider.name = "fake"
        provider.send.return_value = ProviderReceipt(
            message_id="provider-123", cost=Decimal("1.2500")
        )

        with patch("apps.notifications.tasks.get_provider", return_value=provider):
            send_sms(str(shop["tenant"].pk), str(row.pk))
            send_sms(str(shop["tenant"].pk), str(row.pk))

        row.refresh_from_db()
        assert row.status == SmsLog.Status.SENT
        assert row.provider == "fake"
        assert row.provider_message_id == "provider-123"
        assert row.cost == Decimal("1.2500")
        provider.send.assert_called_once_with("9779800000001", "Receipt body")

    def test_permanent_provider_error_marks_failed(self, shop: dict[str, Any]) -> None:
        row = SmsLog.objects.create(
            tenant=shop["tenant"],
            to_phone="9779800000001",
            template="receipt",
            body="Receipt body",
        )
        provider = Mock()
        provider.name = "fake"
        provider.send.side_effect = ProviderError("rejected", retryable=False)

        with patch("apps.notifications.tasks.get_provider", return_value=provider):
            send_sms(str(shop["tenant"].pk), str(row.pk))

        row.refresh_from_db()
        assert row.status == SmsLog.Status.FAILED
        assert row.provider == "fake"

    def test_retryable_provider_error_retries_then_succeeds(self, shop: dict[str, Any]) -> None:
        row = SmsLog.objects.create(
            tenant=shop["tenant"],
            to_phone="9779800000001",
            template="receipt",
            body="Receipt body",
        )
        provider = Mock()
        provider.name = "fake"
        provider.send.side_effect = [
            ProviderError("temporary", retryable=True),
            ProviderReceipt(message_id="provider-456", cost=Decimal("1.0000")),
        ]

        with patch("apps.notifications.tasks.get_provider", return_value=provider):
            result = send_sms.apply(args=(str(shop["tenant"].pk), str(row.pk)))

        assert result.successful()
        row.refresh_from_db()
        assert row.status == SmsLog.Status.SENT
        assert provider.send.call_count == 2


class TestNotificationsApi:
    def test_sms_feature_disabled_returns_plan_402(self, shop: dict[str, Any]) -> None:
        shop["tenant"].plan.features = {"sms": False}
        shop["tenant"].plan.save(update_fields=["features"])
        grant(shop["tenant"], shop["user"], "sale.create")

        response = auth_client(shop["user"]).post(
            RECEIPT_URL, {"invoice": str(shop["invoice"].pk)}, **host(), format="json"
        )

        assert response.status_code == 402
        assert response.json()["error"]["code"] == "PLAN_FEATURE_REQUIRED"

    def test_receipt_requires_sale_create(self, shop: dict[str, Any]) -> None:
        grant(shop["tenant"], shop["user"], "sale.view")
        response = auth_client(shop["user"]).post(
            RECEIPT_URL, {"invoice": str(shop["invoice"].pk)}, **host(), format="json"
        )
        assert response.status_code == 403

    def test_queues_receipt(self, shop: dict[str, Any]) -> None:
        grant(shop["tenant"], shop["user"], "sale.create")
        with patch("apps.notifications.tasks.send_sms.delay"):
            response = auth_client(shop["user"]).post(
                RECEIPT_URL, {"invoice": str(shop["invoice"].pk)}, **host(), format="json"
            )
        assert response.status_code == 201
        assert response.json()["data"]["status"] == "QUEUED"
        assert response.json()["data"]["template"] == "receipt"

    def test_cross_tenant_invoice_is_404(self, shop: dict[str, Any]) -> None:
        grant(shop["tenant"], shop["user"], "sale.create")
        other = SalesInvoiceFactory()
        response = auth_client(shop["user"]).post(
            RECEIPT_URL, {"invoice": str(other.pk)}, **host(), format="json"
        )
        assert response.status_code == 404

    def test_owner_lists_statuses(self, shop: dict[str, Any]) -> None:
        SmsLog.objects.create(
            tenant=shop["tenant"],
            to_phone="9779800000001",
            template="receipt",
            body="Receipt body",
            status=SmsLog.Status.FAILED,
        )
        grant(shop["tenant"], shop["user"], "settings.manage")
        response = auth_client(shop["user"]).get(LIST_URL, {"status": "FAILED"}, **host())
        assert response.status_code == 200
        assert response.json()["meta"]["count"] == 1
        assert response.json()["data"][0]["status"] == "FAILED"

    def test_list_requires_settings_manage(self, shop: dict[str, Any]) -> None:
        grant(shop["tenant"], shop["user"], "sale.create")
        assert auth_client(shop["user"]).get(LIST_URL, **host()).status_code == 403
