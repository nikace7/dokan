"""Write-side business logic for accounts — login with lockout.

One service function, one transaction. The login endpoint is the only
authentication path for tenant users (phone + password, docs/SYSTEM_DESIGN
§8.4); lockout counters live on the user row (docs/DATABASE_SCHEMA.md §3.2).
"""

from datetime import timedelta
from typing import TYPE_CHECKING, Final

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import Role, User, UserRole
from apps.audit.services import audit
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.tenants.models import Branch, Tenant

#: Consecutive failures before the account locks.
MAX_FAILED_LOGINS: Final = 5
#: How long the lockout lasts.
LOCKOUT_DURATION: Final = timedelta(minutes=15)


class AuthError(Exception):
    """Login failure with a machine-readable code for the API envelope."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def authenticate_tenant_user(tenant: "Tenant", phone: str, password: str) -> User:
    """Verify phone + password within one tenant, enforcing lockout.

    Errors are deliberately uniform for unknown phone / inactive user /
    wrong password: the response must not reveal which accounts exist.
    """
    invalid = AuthError("INVALID_CREDENTIALS", "Phone number or password is incorrect.")

    user = User.objects.filter(tenant=tenant, phone=phone.strip()).first()
    if user is None or not user.is_active:
        return _register_failure(None, invalid)

    if user.is_locked:
        until = f" Try again after {user.locked_until:%H:%M}." if user.locked_until else ""
        raise AuthError("ACCOUNT_LOCKED", f"Too many failed login attempts.{until}")

    if not user.check_password(password):
        return _register_failure(user, invalid)

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login = timezone.now()
    user.save(update_fields=["failed_login_count", "locked_until", "last_login", "updated_at"])
    return user


def _register_failure(user: User | None, error: AuthError) -> "User":
    """Increment the failure counter and lock at the threshold; always raises."""
    if user is not None:
        user.failed_login_count += 1
        update_fields = ["failed_login_count", "updated_at"]
        if user.failed_login_count >= MAX_FAILED_LOGINS:
            user.locked_until = timezone.now() + LOCKOUT_DURATION
            user.failed_login_count = 0
            update_fields.append("locked_until")
        user.save(update_fields=update_fields)
    raise error


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


def _validate_assignment(tenant: "Tenant", role: Role, branch: "Branch | None") -> None:
    if role.tenant_id != tenant.pk:
        raise ServiceError("NOT_FOUND", "Role not found.", http_status=404)
    if branch is not None and branch.tenant_id != tenant.pk:
        raise ServiceError("NOT_FOUND", "Branch not found.", http_status=404)
