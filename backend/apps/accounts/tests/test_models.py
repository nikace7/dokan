"""Model and permission-wiring tests for accounts."""

import pytest
from django.db import IntegrityError

from apps.accounts.models import Permission, User
from apps.accounts.selectors import get_permission_codes, invalidate_permission_cache
from core.permissions.catalog import ALL_CODES
from tests.factories import (
    DEFAULT_PASSWORD,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db


class TestPermissionCatalogSeeded:
    def test_migration_seeded_the_catalog(self) -> None:
        """accounts.0001 seeds the DB mirror of core/permissions/catalog.py."""
        assert Permission.objects.count() == len(ALL_CODES)
        assert Permission.objects.filter(code="sale.create").exists()
        assert Permission.objects.get(code="pricing.view_cost").is_sensitive


class TestUserModel:
    def test_phone_unique_per_tenant(self) -> None:
        tenant = TenantFactory()
        UserFactory(tenant=tenant, phone="9800000001")
        with pytest.raises(IntegrityError):
            UserFactory(tenant=tenant, phone="9800000001")

    def test_same_phone_allowed_in_another_tenant(self) -> None:
        UserFactory(phone="9800000002")
        UserFactory(phone="9800000002")  # different tenant — must not raise

    def test_password_is_hashed_and_checkable(self) -> None:
        user = UserFactory()
        assert user.password != DEFAULT_PASSWORD
        assert user.check_password(DEFAULT_PASSWORD)
        assert not user.check_password("wrong")

    def test_create_superuser_is_refused(self) -> None:
        """Super admins never get a tenant user row (design §2.4)."""
        with pytest.raises(NotImplementedError):
            User.objects.create_superuser(phone="9800000003", tenant=TenantFactory())

    def test_is_locked_property(self) -> None:
        from datetime import timedelta

        from django.utils import timezone

        user = UserFactory(locked_until=timezone.now() + timedelta(minutes=5))
        assert user.is_locked
        user.locked_until = timezone.now() - timedelta(minutes=5)
        assert not user.is_locked


class TestRolePermissionWiring:
    def test_permissions_resolve_through_user_role(self) -> None:
        tenant = TenantFactory()
        role = RoleFactory(tenant=tenant, code="CASHIER", name="Cashier")
        RolePermissionFactory(tenant=tenant, role=role)
        user = UserFactory(tenant=tenant)
        UserRoleFactory(tenant=tenant, user=user, role=role)

        codes = get_permission_codes(user)
        assert "sale.create" in codes
        assert "pricing.view_cost" not in codes
        assert user.has_perm("sale.create")
        assert not user.has_perm("pricing.view_cost")

    def test_inactive_user_has_no_permissions(self) -> None:
        tenant = TenantFactory()
        role = RoleFactory(tenant=tenant)
        RolePermissionFactory(tenant=tenant, role=role)
        user = UserFactory(tenant=tenant, is_active=False)
        UserRoleFactory(tenant=tenant, user=user, role=role)
        assert not user.has_perm("sale.create")

    def test_permission_cache_invalidation(self) -> None:
        tenant = TenantFactory()
        role = RoleFactory(tenant=tenant)
        user = UserFactory(tenant=tenant)
        UserRoleFactory(tenant=tenant, user=user, role=role)
        assert "sale.create" not in get_permission_codes(user)  # caches empty set

        RolePermissionFactory(tenant=tenant, role=role)
        invalidate_permission_cache(user.pk)
        assert "sale.create" in get_permission_codes(user)

    def test_duplicate_user_role_rejected(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        role = RoleFactory(tenant=tenant)
        UserRoleFactory(tenant=tenant, user=user, role=role, branch=None)
        with pytest.raises(IntegrityError):
            # NULL branch must still violate uniqueness (nulls_distinct=False).
            UserRoleFactory(tenant=tenant, user=user, role=role, branch=None)

    def test_role_code_unique_per_tenant(self) -> None:
        tenant = TenantFactory()
        RoleFactory(tenant=tenant, code="OWNER")
        with pytest.raises(IntegrityError):
            RoleFactory(tenant=tenant, code="OWNER")
