"""Plan limits enforced by account write services."""

import pytest

from apps.accounts import services
from core.responses import ServiceError
from tests.factories import RoleFactory, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db


def test_staff_creation_hard_blocks_at_plan_limit() -> None:
    tenant = TenantFactory()
    tenant.plan.limits = {"max_users": 1}
    tenant.plan.save(update_fields=["limits"])
    actor = UserFactory(tenant=tenant)

    with pytest.raises(ServiceError) as exc_info:
        services.create_staff_user(
            tenant,
            actor=actor,
            phone="9800000099",
            full_name="Blocked Staff",
            password="initial123",
            role=RoleFactory(tenant=tenant),
        )

    assert exc_info.value.code == "PLAN_LIMIT_REACHED"
    assert exc_info.value.http_status == 402


def test_inactive_staff_does_not_consume_plan_limit() -> None:
    tenant = TenantFactory()
    tenant.plan.limits = {"max_users": 2}
    tenant.plan.save(update_fields=["limits"])
    actor = UserFactory(tenant=tenant)
    UserFactory(tenant=tenant, is_active=False)

    created = services.create_staff_user(
        tenant,
        actor=actor,
        phone="9800000098",
        full_name="Allowed Staff",
        password="initial123",
        role=RoleFactory(tenant=tenant),
    )

    assert created.is_active is True
