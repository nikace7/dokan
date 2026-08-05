"""Write-side authentication rules for the platform-admin realm."""

from typing import Final

from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from apps.platformadmin.models import PlatformUser
from apps.platformadmin.totp import verify_totp

_DUMMY_PASSWORD_HASH: Final = make_password("platform-auth-timing-placeholder")


class PlatformAuthError(Exception):
    def __init__(self, code: str, message: str, *, http_status: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@transaction.atomic
def authenticate_platform_user(email: str, password: str, otp: str) -> PlatformUser:
    """Require an active platform user, password, and configured TOTP."""
    invalid = PlatformAuthError(
        "INVALID_CREDENTIALS",
        "Email, password, or authentication code is incorrect.",
    )
    user = PlatformUser.objects.filter(email__iexact=email.strip()).first()
    if user is None or not user.is_active:
        check_password(password, _DUMMY_PASSWORD_HASH)
        raise invalid
    if not user.check_password(password):
        raise invalid
    if not user.totp_secret:
        raise PlatformAuthError(
            "TWO_FACTOR_NOT_CONFIGURED",
            "Two-factor authentication must be configured before admin login.",
            http_status=403,
        )
    if not verify_totp(user.totp_secret, otp):
        raise invalid
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at"])
    return user
