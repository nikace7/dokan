"""Write-side business logic for accounts — login with lockout.

One service function, one transaction. The login endpoint is the only
authentication path for tenant users (phone + password, docs/SYSTEM_DESIGN
§8.4); lockout counters live on the user row (docs/DATABASE_SCHEMA.md §3.2).
"""

from datetime import timedelta
from typing import TYPE_CHECKING, Final

from django.utils import timezone

from apps.accounts.models import User

if TYPE_CHECKING:
    from apps.tenants.models import Tenant

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
