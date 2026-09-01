"""Factories for accounts: role, user, and their join tables.

Join-table factories propagate ``tenant`` into their related factories via
``SelfAttribute("..tenant")`` so a test can pass one tenant and get a
consistent graph (docs/SYSTEM_DESIGN.md §8.7 convention).
"""

import uuid
from datetime import timedelta

from django.utils import timezone
from factory import LazyFunction, PostGenerationMethodCall, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.accounts.models import (
    AccountOtp,
    AuthSession,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from tests.factories.tenant import TenantFactory

#: Default password for factory users; tests log in with this.
DEFAULT_PASSWORD = "password123"


class RoleFactory(DjangoModelFactory):
    class Meta:
        model = Role

    tenant = SubFactory(TenantFactory)
    code = Sequence(lambda n: f"ROLE{n:03d}")
    name = Sequence(lambda n: f"Role {n}")


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User

    tenant = SubFactory(TenantFactory)
    phone = Sequence(lambda n: f"98{n:08d}")
    full_name = Sequence(lambda n: f"Staff {n}")
    password = PostGenerationMethodCall("set_password", DEFAULT_PASSWORD)


class AuthSessionFactory(DjangoModelFactory):
    class Meta:
        model = AuthSession

    tenant = SubFactory(TenantFactory)
    user = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))
    device_id = LazyFunction(uuid.uuid4)
    device_name = Sequence(lambda n: f"Test device {n}")
    expires_at = LazyFunction(lambda: timezone.now() + timedelta(days=30))


class AccountOtpFactory(DjangoModelFactory):
    class Meta:
        model = AccountOtp

    tenant = SubFactory(TenantFactory)
    user = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))
    purpose = AccountOtp.Purpose.PASSWORD_RESET
    code_hash = "0" * 64
    expires_at = LazyFunction(lambda: timezone.now() + timedelta(minutes=10))


class RolePermissionFactory(DjangoModelFactory):
    class Meta:
        model = RolePermission

    tenant = SubFactory(TenantFactory)
    role = SubFactory(RoleFactory, tenant=SelfAttribute("..tenant"))
    permission = LazyFunction(lambda: Permission.objects.get(code="sale.create"))


class UserRoleFactory(DjangoModelFactory):
    class Meta:
        model = UserRole

    tenant = SubFactory(TenantFactory)
    user = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))
    role = SubFactory(RoleFactory, tenant=SelfAttribute("..tenant"))
    branch = None  # NULL = all branches
