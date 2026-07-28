"""Tenant staff identity: user, role, permission catalog, assignments.

Tables (docs/DATABASE_SCHEMA.md §3.2–3.6): ``user``, ``role``,
``permission`` (global catalog — no tenant_id, no RLS), ``role_permission``,
``user_role``. Everything except ``permission`` is tenant-scoped and gets
RLS in the migration.

Django's auth_permission / Group machinery is deliberately unused: the
permission catalog here is the DB mirror of ``core/permissions/catalog.py``
and ``User.has_perm`` resolves through user_role → role_permission.
"""

import uuid
from typing import Any, ClassVar

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone

from core.models import TenantScopedModel


class Permission(models.Model):
    """Global permission catalog (platform scope). DB mirror of the code catalog."""

    code = models.TextField(primary_key=True)  # e.g. "sale.create"
    module = models.TextField()
    name = models.TextField()
    description = models.TextField(null=True, blank=True)
    is_sensitive = models.BooleanField(default=False)

    class Meta:
        db_table = "permission"

    def __str__(self) -> str:
        return self.code


class Role(TenantScopedModel):
    """A role within one tenant (OWNER, MANAGER, CASHIER, …)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.TextField()
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    is_system = models.BooleanField(default=False)  # system roles cannot be deleted
    description = models.TextField(null=True, blank=True)
    permissions: models.ManyToManyField = models.ManyToManyField(
        Permission, through="RolePermission", related_name="roles"
    )

    class Meta:
        db_table = "role"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="role_tenant_code_uniq")
        ]

    def __str__(self) -> str:
        return f"{self.code} ({self.tenant_id})"


class UserManager(BaseUserManager["User"]):
    """Manager for the tenant-scoped user. Tenant is always required."""

    def create_user(
        self,
        phone: str,
        password: str | None = None,
        *,
        tenant: Any,
        full_name: str,
        **extra_fields: Any,
    ) -> "User":
        """Create a tenant staff user. Phone is normalized by stripping."""
        if not phone:
            msg = "Phone is required."
            raise ValueError(msg)
        user = self.model(phone=phone.strip(), tenant=tenant, full_name=full_name, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, **kwargs: Any) -> "User":
        """Not supported: platform admins live in platform_user, never here.

        A super admin must never get a row in a tenant's user table
        (docs/SYSTEM_DESIGN.md §2.4). Use apps.platformadmin instead.
        """
        raise NotImplementedError(
            "Tenant users cannot be superusers; create a PlatformUser instead."
        )


class User(TenantScopedModel, AbstractBaseUser):
    """Tenant staff member. Phone-based login, per-tenant uniqueness."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.TextField()
    email = models.TextField(null=True, blank=True)
    # AbstractBaseUser.password, stored under the schema's column name.
    password = models.TextField(db_column="password_hash")
    full_name = models.TextField()
    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(default=False)
    last_login = models.DateTimeField(null=True, blank=True, db_column="last_login_at")
    failed_login_count = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS: ClassVar = ["full_name"]

    class Meta:
        db_table = "user"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "phone"], name="user_tenant_phone_uniq")
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.phone})"

    @property
    def is_locked(self) -> bool:
        """True while a failed-login lockout is in effect."""
        return self.locked_until is not None and self.locked_until > timezone.now()

    def has_perm(self, perm: str, obj: models.Model | None = None) -> bool:
        """Resolve a permission codename via user_role → role_permission.

        Result is cached in Redis (5 min TTL, selectors.get_permission_codes);
        invalidated on any user_role / role_permission write.
        """
        from apps.accounts.selectors import get_permission_codes

        return self.is_active and perm in get_permission_codes(self)

    def has_module_perms(self, app_label: str) -> bool:
        """Django admin compatibility — tenant users never use django-admin."""
        return False


class RolePermission(TenantScopedModel):
    """Join: which permissions a role grants. tenant_id per MULTI_TENANCY §8."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(
        Permission,
        on_delete=models.CASCADE,
        related_name="role_permissions",
        db_column="permission_code",
    )

    class Meta:
        db_table = "role_permission"
        constraints = [
            models.UniqueConstraint(fields=["role", "permission"], name="role_permission_uniq")
        ]


class UserRole(TenantScopedModel):
    """Role assignment; branch NULL means the role applies to all branches."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles")
    branch = models.ForeignKey(
        "tenants.Branch",
        on_delete=models.CASCADE,
        related_name="+",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "user_role"
        constraints = [
            # NULL branch (= all branches) must not allow duplicate rows.
            models.UniqueConstraint(
                fields=["tenant", "user", "role", "branch"],
                nulls_distinct=False,
                name="user_role_uniq",
            )
        ]
