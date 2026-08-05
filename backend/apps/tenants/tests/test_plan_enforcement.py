"""Plan resolution, middleware gating, and usage reconciliation tests."""

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.conf import settings
from django.http import HttpResponse
from django.test import RequestFactory
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Item
from apps.notifications.models import SmsLog
from apps.sales.models import SalesInvoice
from apps.tenants import selectors, services
from apps.tenants.constants import TenantStatus
from apps.tenants.models import TenantFeatureOverride, TenantUsageSnapshot
from apps.tenants.tasks import reconcile_usage_snapshots
from core.middleware.plan_gate import PlanGateMiddleware
from tests.factories import (
    ItemFactory,
    SalesInvoiceFactory,
    SmsLogFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


class TestPlanResolution:
    def test_active_override_wins_over_plan(self) -> None:
        tenant = TenantFactory()
        tenant.plan.features = {"sms": True}
        tenant.plan.save(update_fields=["features"])
        TenantFeatureOverride.objects.create(
            tenant=tenant,
            key="features.sms",
            value=False,
        )

        assert selectors.is_feature_enabled(tenant, "sms") is False

    def test_expired_override_falls_back_to_plan(self) -> None:
        tenant = TenantFactory()
        tenant.plan.features = {"sms": True}
        tenant.plan.save(update_fields=["features"])
        TenantFeatureOverride.objects.create(
            tenant=tenant,
            key="features.sms",
            value=False,
            expires_at=timezone.now() - timedelta(seconds=1),
        )

        assert selectors.is_feature_enabled(tenant, "sms") is True


class TestPlanGateMiddleware:
    def test_registered_after_tenant_middleware(self) -> None:
        tenant_index = settings.MIDDLEWARE.index("core.middleware.tenant.TenantMiddleware")
        gate_index = settings.MIDDLEWARE.index("core.middleware.plan_gate.PlanGateMiddleware")
        assert gate_index == tenant_index + 1

    def test_disabled_feature_returns_machine_readable_402(self) -> None:
        tenant = TenantFactory()
        tenant.plan.features = {"sms": False}
        tenant.plan.save(update_fields=["features"])
        request = RequestFactory().post("/api/v1/notifications/sms/receipt")
        request.tenant = tenant
        view = SimpleNamespace(
            view_class=type(
                "SmsView",
                (),
                {"plan_features_by_method": {"POST": "sms"}},
            )
        )
        middleware = PlanGateMiddleware(lambda _: HttpResponse(status=201))

        response = middleware.process_view(request, view, (), {})

        assert response is not None
        assert response.status_code == 402
        assert json.loads(response.content)["error"]["code"] == "PLAN_FEATURE_REQUIRED"

    def test_invoice_volume_warns_without_blocking(self, monkeypatch: pytest.MonkeyPatch) -> None:
        tenant = TenantFactory()
        request = RequestFactory().post("/api/v1/sales")
        request.tenant = tenant
        view = SimpleNamespace(
            view_class=type(
                "SaleView",
                (),
                {"plan_usage_by_method": {"POST": "max_invoices_per_month"}},
            )
        )
        monkeypatch.setattr(
            "core.middleware.plan_gate.get_usage_warning",
            lambda *_: ("PLAN_USAGE_WARNING_80", 8, 10),
        )
        middleware = PlanGateMiddleware(lambda _: HttpResponse(status=201))
        assert middleware.process_view(request, view, (), {}) is None

        response = middleware(request)

        assert response.status_code == 201
        assert response["X-Plan-Usage-Warning"] == "PLAN_USAGE_WARNING_80"
        assert response["X-Plan-Usage"] == "8"
        assert response["X-Plan-Limit"] == "10"


class TestUsageReconciliation:
    def test_nightly_schedule_is_registered(self) -> None:
        assert settings.CELERY_BEAT_SCHEDULE["tenants-reconcile-usage-nightly"]["task"] == (
            "apps.tenants.tasks.reconcile_usage_snapshots"
        )

    def test_nightly_task_processes_only_active_tenants(self) -> None:
        active = TenantFactory()
        TenantFactory(status=TenantStatus.SUSPENDED)

        processed = reconcile_usage_snapshots()

        assert processed == 1
        assert TenantUsageSnapshot.objects.filter(tenant=active).exists()

    def test_snapshot_counts_current_tenant_usage(self) -> None:
        tenant = TenantFactory()
        UserFactory(tenant=tenant)
        ItemFactory(tenant=tenant)
        SalesInvoiceFactory(tenant=tenant, business_date_ad=timezone.localdate())
        SmsLogFactory(tenant=tenant)

        snapshot = services.reconcile_tenant_usage(tenant)

        assert snapshot.users == User.objects.filter(tenant=tenant, is_active=True).count()
        assert snapshot.items == Item.objects.filter(tenant=tenant, is_active=True).count()
        assert (
            snapshot.invoices_mtd
            == SalesInvoice.objects.filter(
                tenant=tenant,
                doc_type=SalesInvoice.DocType.SALE,
                status=SalesInvoice.Status.COMPLETED,
                business_date_ad__year=timezone.localdate().year,
                business_date_ad__month=timezone.localdate().month,
            ).count()
        )
        assert snapshot.sms_used == SmsLog.objects.filter(tenant=tenant).count()
        assert snapshot.storage_mb == 0

    def test_same_day_reconciliation_updates_one_snapshot(self) -> None:
        tenant = TenantFactory()
        first = services.reconcile_tenant_usage(tenant)
        UserFactory(tenant=tenant)

        second = services.reconcile_tenant_usage(tenant)

        assert first.pk == second.pk
        assert (
            TenantUsageSnapshot.objects.filter(tenant=tenant, date=timezone.localdate()).count()
            == 1
        )
        assert second.users == 1
