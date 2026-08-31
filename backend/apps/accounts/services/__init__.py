"""Write-side business logic for accounts — login with lockout.

One service function, one transaction. The login endpoint is the only
authentication path for tenant users (phone + password, docs/SYSTEM_DESIGN
§8.4); lockout counters live on the user row (docs/DATABASE_SCHEMA.md §3.2).
"""

import re
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction

from apps.accounts.models import Permission, Role, RolePermission, User, UserRole
from apps.accounts.services.auth import (
    LOCKOUT_DURATION as LOCKOUT_DURATION,
)
from apps.accounts.services.auth import (
    MAX_FAILED_LOGINS as MAX_FAILED_LOGINS,
)
from apps.accounts.services.auth import (
    AuthError as AuthError,
)
from apps.accounts.services.auth import (
    authenticate_tenant_user as authenticate_tenant_user,
)
from apps.accounts.services.staff_roles import (
    unassign_staff_role as unassign_staff_role,
)
from apps.audit.services import audit
from apps.tenants.services import enforce_creation_limit
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.tenants.models import Branch, Tenant


@transaction.atomic
def create_staff_user(
    tenant: "Tenant",
    *,
    actor: User,
    phone: str,
    full_name: str,
    password: str,
    role: Role,
    branch: "Branch | None" = None,
    email: str | None = None,
    request: "HttpRequest | None" = None,
) -> User:
    """Create staff with an initial password and one existing role."""
    _validate_assignment(tenant, role, branch)
    enforce_creation_limit(
        tenant,
        key="max_users",
        queryset=User.objects.filter(tenant=tenant, is_active=True),
        label="active staff accounts",
    )
    user = User(
        tenant=tenant,
        phone=phone.strip(),
        full_name=full_name.strip(),
        email=email.strip() if email else None,
        must_change_password=True,
    )
    user.set_password(password)
    try:
        user.save()
        UserRole.objects.create(tenant=tenant, user=user, role=role, branch=branch)
    except IntegrityError as exc:
        if "user_tenant_phone_uniq" in str(exc):
            raise ServiceError(
                "ALREADY_EXISTS", "A staff account with this phone already exists."
            ) from exc
        raise

    audit(
        tenant,
        actor=actor,
        action="user.create",
        target_type="user",
        target_id=user,
        after={"phone": user.phone, "full_name": user.full_name, "role": role.code},
        request=request,
    )
    return user


@transaction.atomic
def assign_staff_role(
    tenant: "Tenant",
    *,
    actor: User,
    user: User,
    role: Role,
    branch: "Branch | None" = None,
    request: "HttpRequest | None" = None,
) -> tuple[UserRole, bool]:
    """Assign an existing role, invalidating permission resolution cache."""
    _validate_assignment(tenant, role, branch)
    if user.tenant_id != tenant.pk:
        raise ServiceError("NOT_FOUND", "Staff account not found.", http_status=404)
    assignment, created = UserRole.objects.get_or_create(
        tenant=tenant, user=user, role=role, branch=branch
    )
    if created:
        from apps.accounts.selectors import invalidate_permission_cache

        invalidate_permission_cache(user.pk)
        audit(
            tenant,
            actor=actor,
            action="user.role.assign",
            target_type="user",
            target_id=user,
            after={
                "role": role.code,
                "branch": branch.code if branch else None,
            },
            request=request,
        )
    return assignment, created


@transaction.atomic
def create_role(
    tenant: "Tenant",
    *,
    actor: User,
    code: str,
    name: str,
    name_np: str | None = None,
    description: str | None = None,
    permission_codes: list[str] | None = None,
    request: "HttpRequest | None" = None,
) -> Role:
    """Create a custom role from the global permission catalog."""
    normalized_code = _normalize_role_code(code)
    clean_name = _required_text(name, "Role name")
    codes, permissions = _resolve_permissions(permission_codes or [])
    if Role.objects.filter(tenant=tenant, code=normalized_code).exists():
        raise ServiceError("ALREADY_EXISTS", "A role with this code already exists.")
    try:
        with transaction.atomic():
            role = Role.objects.create(
                tenant=tenant,
                code=normalized_code,
                name=clean_name,
                name_np=name_np.strip() if name_np else None,
                description=description.strip() if description else None,
                is_system=False,
            )
    except IntegrityError as exc:
        if "role_tenant_code_uniq" in str(exc):
            raise ServiceError("ALREADY_EXISTS", "A role with this code already exists.") from exc
        raise
    _replace_role_permissions(tenant, role, permissions)
    audit(
        tenant,
        actor=actor,
        action="role.create",
        target_type="role",
        target_id=role,
        after={"code": role.code, "name": role.name, "permission_codes": codes},
        request=request,
    )
    return role


@transaction.atomic
def update_role(
    tenant: "Tenant",
    *,
    actor: User,
    role: Role,
    changes: Mapping[str, Any],
    request: "HttpRequest | None" = None,
) -> Role:
    """Update a custom role and invalidate affected staff permission caches."""
    locked = Role.objects.select_for_update().filter(tenant=tenant, pk=role.pk).first()
    if locked is None:
        raise ServiceError("NOT_FOUND", "Role not found.", http_status=404)
    if locked.is_system:
        raise ServiceError("SYSTEM_ROLE", "System roles cannot be changed.", http_status=409)

    before = _role_snapshot(locked)
    update_fields: list[str] = []
    for field in ("name", "name_np", "description"):
        if field not in changes:
            continue
        value = changes[field]
        if field == "name":
            value = _required_text(value, "Role name")
        elif value:
            value = value.strip()
        else:
            value = None
        setattr(locked, field, value)
        update_fields.append(field)
    if update_fields:
        update_fields.append("updated_at")
        locked.save(update_fields=update_fields)

    if "permission_codes" in changes:
        codes, permissions = _resolve_permissions(changes["permission_codes"])
        current_codes = set(
            RolePermission.objects.filter(role=locked).values_list("permission_id", flat=True)
        )
        if current_codes != set(codes):
            _replace_role_permissions(tenant, locked, permissions)

    after = _role_snapshot(locked)
    if before != after:
        audit(
            tenant,
            actor=actor,
            action="role.update",
            target_type="role",
            target_id=locked,
            before=before,
            after=after,
            request=request,
        )
    return locked


@transaction.atomic
def delete_role(
    tenant: "Tenant",
    *,
    actor: User,
    role: Role,
    request: "HttpRequest | None" = None,
) -> None:
    """Delete an unused custom role; system and assigned roles are protected."""
    locked = Role.objects.select_for_update().filter(tenant=tenant, pk=role.pk).first()
    if locked is None:
        raise ServiceError("NOT_FOUND", "Role not found.", http_status=404)
    if locked.is_system:
        raise ServiceError("SYSTEM_ROLE", "System roles cannot be deleted.", http_status=409)
    if UserRole.objects.filter(role=locked).exists():
        raise ServiceError(
            "ROLE_IN_USE",
            "Remove staff assignments before deleting this role.",
            http_status=409,
        )
    before = _role_snapshot(locked)
    role_id = locked.pk
    locked.delete()
    audit(
        tenant,
        actor=actor,
        action="role.delete",
        target_type="role",
        target_id=role_id,
        before=before,
        request=request,
    )


def _normalize_role_code(code: str) -> str:
    normalized = code.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", normalized):
        raise ServiceError(
            "INVALID_ROLE_CODE",
            "Role code must start with a letter and contain only letters, numbers, "
            "and underscores.",
        )
    return normalized


def _required_text(value: Any, label: str) -> str:
    clean = str(value).strip()
    if not clean:
        raise ServiceError("VALIDATION_ERROR", f"{label} is required.")
    return clean


def _resolve_permissions(codes: list[str]) -> tuple[list[str], list[Permission]]:
    normalized = [code.strip() for code in codes]
    if len(set(normalized)) != len(normalized):
        raise ServiceError("INVALID_PERMISSIONS", "Permission codes must not be repeated.")
    permissions = list(Permission.objects.filter(code__in=normalized))
    found = {permission.code for permission in permissions}
    missing = sorted(set(normalized) - found)
    if missing:
        raise ServiceError("INVALID_PERMISSIONS", f"Unknown permission: {', '.join(missing)}")
    permissions.sort(key=lambda permission: permission.code)
    return sorted(normalized), permissions


def _replace_role_permissions(tenant: "Tenant", role: Role, permissions: list[Permission]) -> None:
    affected_user_ids = list(UserRole.objects.filter(role=role).values_list("user_id", flat=True))
    RolePermission.objects.filter(role=role).delete()
    RolePermission.objects.bulk_create(
        [
            RolePermission(tenant=tenant, role=role, permission=permission)
            for permission in permissions
        ]
    )
    from apps.accounts.selectors import invalidate_permission_cache

    for user_id in affected_user_ids:
        invalidate_permission_cache(user_id)


def _role_snapshot(role: Role) -> dict[str, Any]:
    return {
        "code": role.code,
        "name": role.name,
        "name_np": role.name_np,
        "description": role.description,
        "permission_codes": sorted(
            RolePermission.objects.filter(role=role).values_list("permission_id", flat=True)
        ),
    }


def _validate_assignment(tenant: "Tenant", role: Role, branch: "Branch | None") -> None:
    if role.tenant_id != tenant.pk:
        raise ServiceError("NOT_FOUND", "Role not found.", http_status=404)
    if branch is not None and branch.tenant_id != tenant.pk:
        raise ServiceError("NOT_FOUND", "Branch not found.", http_status=404)
