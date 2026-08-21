"""Staff role revocation — the write side of editing a user's roles.

Revocation is a hard delete of the UserRole row: assignments are
configuration, not history, and the audit log carries the trail. One
invariant protects the shop: the tenant must never lose its last
all-branches OWNER assignment, or nobody can administer it.
"""

from typing import TYPE_CHECKING

from django.db import transaction

from apps.audit.services import audit
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.accounts.models import User, UserRole
    from apps.tenants.models import Tenant

#: The system role whose last tenant-wide assignment is never revocable.
LOCKOUT_GUARDED_ROLE_CODE = "OWNER"


@transaction.atomic
def unassign_staff_role(
    tenant: "Tenant",
    *,
    actor: "User",
    user: "User",
    assignment: "UserRole",
    request: "HttpRequest | None" = None,
) -> None:
    """Revoke one role assignment, invalidating the permission cache."""
    from apps.accounts.models import UserRole as UserRoleModel

    if assignment.tenant_id != tenant.pk or assignment.user_id != user.pk:
        raise ServiceError("NOT_FOUND", "Role assignment not found.", http_status=404)
    is_owner_wide = (
        assignment.role.code == LOCKOUT_GUARDED_ROLE_CODE and assignment.branch_id is None
    )
    if (
        is_owner_wide
        and not UserRoleModel.objects.filter(
            tenant=tenant, role__code=LOCKOUT_GUARDED_ROLE_CODE, branch__isnull=True
        )
        .exclude(pk=assignment.pk)
        .exists()
    ):
        raise ServiceError(
            "LAST_OWNER_ROLE",
            "The shop must keep at least one owner. Assign another owner first.",
        )
    before = {
        "role": assignment.role.code,
        "branch": assignment.branch.code if assignment.branch else None,
    }
    assignment.delete()
    from apps.accounts.selectors import invalidate_permission_cache

    invalidate_permission_cache(user.pk)
    audit(
        tenant,
        actor=actor,
        action="user.role.revoke",
        target_type="user",
        target_id=user,
        before=before,
        request=request,
    )
