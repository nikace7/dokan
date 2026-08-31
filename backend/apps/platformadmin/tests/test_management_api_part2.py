"""Platform control-plane API tests: plans, tenants, billing, usage, and audit."""

from datetime import timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.platformadmin.models import PlatformAuditLog, PlatformUser
from apps.platformadmin.tokens import issue_platform_tokens
from apps.tenants.models import (
    Plan,
    Tenant,
    TenantFeatureOverride,
    TenantSubscription,
    TenantUsageSnapshot,
)
from tests.factories import PlanFactory, TenantFactory

pytestmark = pytest.mark.django_db

PLANS_URL = "/api/v1/admin/plans"
TENANTS_URL = "/api/v1/admin/tenants"
AUDIT_URL = "/api/v1/admin/audit"


def admin_host() -> dict[str, str]:
    return {
        "HTTP_HOST": "admin.dokan.com.np",
        "REMOTE_ADDR": "10.0.0.4",
        "HTTP_X_FORWARDED_FOR": "198.51.100.9, 203.0.113.8",
    }


@pytest.fixture(autouse=True)
def admin_boundary(settings: Any) -> None:
    settings.PLATFORM_ADMIN_ALLOWED_IPS = ["203.0.113.0/24"]
    cache.clear()


def platform_user(role: str = PlatformUser.Role.SUPER_ADMIN) -> PlatformUser:
    user = PlatformUser.objects.create(
        email=f"{role.lower()}-{uuid4()}@dokan.test",
        full_name=role.replace("_", " ").title(),
        role=role,
        password_hash="unused",
        totp_secret="unused",
    )
    return user


def client_for(role: str = PlatformUser.Role.SUPER_ADMIN) -> tuple[APIClient, PlatformUser]:
    user = platform_user(role)
    access = issue_platform_tokens(user)["access"]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client, user


def plan_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "code": "basic",
        "name": "Basic",
        "price_npr": "1500.00",
        "billing_cycle": Plan.BillingCycle.MONTHLY,
        "limits": {
            "max_users": 5,
            "max_branches": 1,
            "max_items": 2000,
            "max_invoices_per_month": 3000,
            "sms_credits_per_month": 100,
        },
        "features": {
            "sms": True,
            "profit_reports": True,
            "custom_rate_types": True,
            "max_rate_types": 3,
            "multi_branch": False,
            "vat_module": False,
        },
        "sort_order": 10,
    }
    payload.update(overrides)
    return payload


def tenant_payload(plan: Plan, **overrides: Any) -> dict[str, Any]:
    payload = {
        "slug": "himalayan-fashion",
        "name": "Himalayan Fashion",
        "plan": str(plan.pk),
        "status": "TRIAL",
        "trial_ends_at": (timezone.now() + timedelta(days=14)).isoformat(),
        "owner_phone": "9800000001",
        "owner_full_name": "Shop Owner",
        "owner_email": "owner@example.test",
        "owner_password": "a secure owner password",
        "branch_code": "MAIN",
        "branch_name": "Main Branch",
    }
    payload.update(overrides)
    return payload


class TestSubscriptionUsageAndOverrides:
    def test_billing_records_subscription_but_cannot_manage_plans(self) -> None:
        tenant = cast("Tenant", TenantFactory())
        plan = cast("Plan", PlanFactory(code="upgrade"))
        client, actor = client_for(PlatformUser.Role.BILLING)
        response = client.post(
            f"{TENANTS_URL}/{tenant.pk}/subscriptions",
            {
                "plan": str(plan.pk),
                "period_start": "2026-08-01",
                "period_end": "2026-08-31",
                "amount_npr": "2500.00",
                "status": "PAID",
                "payment_ref": "bank-42",
            },
            format="json",
            **admin_host(),
        )
        assert response.status_code == 201
        subscription = TenantSubscription.objects.get(tenant=tenant)
        assert subscription.plan == plan
        assert subscription.amount_npr == Decimal("2500.00")
        assert PlatformAuditLog.objects.filter(
            actor=actor,
            tenant=tenant,
            action="subscription.create",
        ).exists()
        assert (
            client.post(
                PLANS_URL, plan_payload(code="billing"), format="json", **admin_host()
            ).status_code
            == 403
        )

    def test_subscription_period_must_be_ordered(self) -> None:
        tenant = TenantFactory()
        client, _ = client_for(PlatformUser.Role.BILLING)
        response = client.post(
            f"{TENANTS_URL}/{tenant.pk}/subscriptions",
            {
                "plan": str(tenant.plan_id),
                "period_start": "2026-09-01",
                "period_end": "2026-08-31",
                "amount_npr": "1000.00",
                "status": "PENDING",
            },
            format="json",
            **admin_host(),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "SUBSCRIPTION_PERIOD_INVALID"

    def test_usage_is_scoped_to_requested_tenant(self) -> None:
        tenant = TenantFactory()
        other = TenantFactory()
        today = timezone.localdate()
        TenantUsageSnapshot.objects.create(
            tenant=tenant,
            date=today,
            users=2,
            items=10,
            invoices_mtd=4,
            storage_mb=0,
            sms_used=1,
        )
        TenantUsageSnapshot.objects.create(
            tenant=other,
            date=today,
            users=99,
            items=99,
            invoices_mtd=99,
            storage_mb=99,
            sms_used=99,
        )
        client, _ = client_for(PlatformUser.Role.SUPPORT)
        response = client.get(f"{TENANTS_URL}/{tenant.pk}/usage", **admin_host())
        assert response.status_code == 200
        assert len(response.json()["data"]) == 1
        assert response.json()["data"][0]["users"] == 2

    def test_override_upsert_and_delete_are_audited(self) -> None:
        tenant = TenantFactory()
        client, _ = client_for()
        url = f"{TENANTS_URL}/{tenant.pk}/overrides"
        created = client.post(
            url,
            {"key": "features.sms", "value": False, "note": "Pilot exception"},
            format="json",
            **admin_host(),
        )
        assert created.status_code == 201
        override = TenantFeatureOverride.objects.get(tenant=tenant, key="features.sms")

        updated = client.post(
            url,
            {"key": "features.sms", "value": True, "note": "Enabled for pilot"},
            format="json",
            **admin_host(),
        )
        assert updated.status_code == 200
        override.refresh_from_db()
        assert override.value is True

        deleted = client.delete(
            f"{url}/{override.pk}",
            **admin_host(),
        )
        assert deleted.status_code == 200
        assert not TenantFeatureOverride.objects.filter(pk=override.pk).exists()
        assert list(
            PlatformAuditLog.objects.filter(tenant=tenant).values_list("action", flat=True)
        ) == ["feature_override.delete", "feature_override.set", "feature_override.set"]

    def test_only_super_admin_can_read_platform_audit(self) -> None:
        tenant = TenantFactory()
        actor = platform_user()
        PlatformAuditLog.objects.create(
            actor=actor,
            tenant=tenant,
            action="tenant.update",
            payload={"after": {"status": "ACTIVE"}},
        )
        support, _ = client_for(PlatformUser.Role.SUPPORT)
        assert support.get(AUDIT_URL, **admin_host()).status_code == 403

        super_admin, _ = client_for()
        response = super_admin.get(
            AUDIT_URL,
            {"tenant": str(tenant.pk), "action": "tenant.update"},
            **admin_host(),
        )
        assert response.status_code == 200
        assert len(response.json()["data"]) == 1
        assert response.json()["data"][0]["tenant"] == str(tenant.pk)
