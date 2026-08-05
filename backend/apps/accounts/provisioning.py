"""Create a new tenant's built-in roles and first owner identity."""

from typing import TYPE_CHECKING

from apps.accounts.models import Permission, Role, RolePermission, User, UserRole
from apps.accounts.system_roles import SYSTEM_ROLE_NAMES, SYSTEM_ROLE_PERMISSIONS
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.tenants.models import Tenant


def _required(value: str, label: str) -> str:
    clean = value.strip()
    if not clean:
        raise ServiceError("TENANT_INVALID", f"{label} is required.")
    return clean


def _create_system_roles(tenant: "Tenant") -> dict[str, Role]:
    permissions = {row.code: row for row in Permission.objects.all()}
    missing = set().union(*SYSTEM_ROLE_PERMISSIONS.values()) - permissions.keys()
    if missing:
        raise ServiceError(
            "PERMISSION_CATALOG_INCOMPLETE",
            "The permission catalog is incomplete; provisioning cannot continue.",
            http_status=500,
        )
    roles = {
        code: Role.objects.create(
            tenant=tenant,
            code=code,
            name=SYSTEM_ROLE_NAMES[code],
            is_system=True,
        )
        for code in SYSTEM_ROLE_NAMES
    }
    RolePermission.objects.bulk_create(
        [
            RolePermission(tenant=tenant, role=roles[code], permission=permissions[permission])
            for code, codes in SYSTEM_ROLE_PERMISSIONS.items()
            for permission in codes
        ]
    )
    return roles


def provision_owner(
    tenant: "Tenant",
    *,
    phone: str,
    full_name: str,
    password: str,
    email: str | None = None,
) -> User:
    """Create five least-privilege roles and assign all permissions to the owner."""
    if len(password) < 12:
        raise ServiceError("TENANT_INVALID", "Owner password must contain at least 12 characters.")
    roles = _create_system_roles(tenant)
    owner = User(
        tenant=tenant,
        phone=_required(phone, "Owner phone"),
        full_name=_required(full_name, "Owner name"),
        email=email.strip() if email else None,
        must_change_password=True,
    )
    owner.set_password(password)
    owner.save()
    UserRole.objects.create(tenant=tenant, user=owner, role=roles["OWNER"], branch=None)
    return owner
