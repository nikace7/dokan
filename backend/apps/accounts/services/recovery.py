"""Password recovery, optional login OTP, and password-change services."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING, Any, Final, cast

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import AccountOtp, AuthSession, User
from apps.accounts.services.auth import revoke_other_sessions
from apps.audit.services import audit
from apps.notifications.services import queue_account_otp_sms
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.tenants.models import Tenant

OTP_TTL: Final = timedelta(minutes=10)
OTP_RESEND_COOLDOWN: Final = timedelta(seconds=60)
MAX_OTP_ATTEMPTS: Final = 5


def _validate_new_password(user: User, password: str) -> None:
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        raise ServiceError("PASSWORD_INVALID", " ".join(exc.messages)) from exc


@transaction.atomic
def change_password(
    tenant: Tenant,
    *,
    actor: User,
    current_session_id: Any,
    current_password: str,
    new_password: str,
    request: HttpRequest | None,
) -> None:
    user = User.objects.select_for_update().get(tenant=tenant, pk=actor.pk)
    if not user.check_password(current_password):
        raise ServiceError("CURRENT_PASSWORD_INVALID", "Current password is incorrect.")
    _validate_new_password(user, new_password)
    user.set_password(new_password)
    user.must_change_password = False
    user.failed_login_count = 0
    user.locked_until = None
    user.save(
        update_fields=[
            "password",
            "must_change_password",
            "failed_login_count",
            "locked_until",
            "updated_at",
        ]
    )
    revoke_other_sessions(
        tenant,
        actor=user,
        current_session_id=current_session_id,
        request=request,
    )
    audit(
        tenant,
        actor=user,
        action="auth.password.change",
        target_type="user",
        target_id=user,
        request=request,
    )


def request_password_reset(tenant: Tenant, *, phone: str) -> None:
    """Issue only for a live account; callers always return the same response."""
    user = User.objects.filter(tenant=tenant, phone=phone.strip(), is_active=True).first()
    if user is not None:
        issue_account_otp(tenant, user=user, purpose=AccountOtp.Purpose.PASSWORD_RESET)


def reset_password(
    tenant: Tenant,
    *,
    phone: str,
    code: str,
    new_password: str,
    request: HttpRequest | None,
) -> User:
    user = User.objects.filter(tenant=tenant, phone=phone.strip(), is_active=True).first()
    if user is None:
        raise ServiceError("OTP_INVALID", "The code is invalid or has expired.")
    _validate_new_password(user, new_password)
    verify_account_otp(
        tenant,
        user=user,
        purpose=AccountOtp.Purpose.PASSWORD_RESET,
        code=code,
    )
    with transaction.atomic():
        user = User.objects.select_for_update().get(tenant=tenant, pk=user.pk, is_active=True)
        user.set_password(new_password)
        user.must_change_password = False
        user.failed_login_count = 0
        user.locked_until = None
        user.save(
            update_fields=[
                "password",
                "must_change_password",
                "failed_login_count",
                "locked_until",
                "updated_at",
            ]
        )
        now = timezone.now()
        AuthSession.objects.filter(tenant=tenant, user=user, revoked_at__isnull=True).update(
            revoked_at=now,
            updated_at=now,
        )
        audit(
            tenant,
            actor=user,
            action="auth.password.reset",
            target_type="user",
            target_id=user,
            request=request,
        )
    return user


@transaction.atomic
def issue_account_otp(tenant: Tenant, *, user: User, purpose: AccountOtp.Purpose) -> AccountOtp:
    now = timezone.now()
    recent = (
        AccountOtp.objects.filter(
            tenant=tenant,
            user=user,
            purpose=purpose,
            consumed_at__isnull=True,
            expires_at__gt=now,
            created_at__gte=now - OTP_RESEND_COOLDOWN,
        )
        .order_by("-created_at")
        .first()
    )
    if recent is not None:
        return recent
    AccountOtp.objects.filter(
        tenant=tenant,
        user=user,
        purpose=purpose,
        consumed_at__isnull=True,
    ).update(consumed_at=now, updated_at=now)
    challenge_id = uuid.uuid4()
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = AccountOtp.objects.create(
        id=challenge_id,
        tenant=tenant,
        user=user,
        purpose=purpose,
        code_hash=_otp_hash(challenge_id, code),
        expires_at=now + OTP_TTL,
    )
    queue_account_otp_sms(
        tenant,
        to_phone=user.phone,
        template=_otp_template(purpose),
        code=code,
        expires_minutes=int(OTP_TTL.total_seconds() // 60),
    )
    return challenge


def verify_account_otp(
    tenant: Tenant,
    *,
    user: User,
    purpose: AccountOtp.Purpose,
    code: str,
    challenge_id: Any | None = None,
) -> AccountOtp:
    """Consume a valid OTP while persisting bounded failed attempts."""
    failure: ServiceError | None = None
    verified: AccountOtp | None = None
    with transaction.atomic():
        queryset = AccountOtp.objects.select_for_update().filter(
            tenant=tenant,
            user=user,
            purpose=purpose,
            consumed_at__isnull=True,
        )
        if challenge_id is not None:
            queryset = queryset.filter(pk=challenge_id)
        challenge = queryset.order_by("-created_at").first()
        if challenge is None:
            failure = ServiceError("OTP_INVALID", "The code is invalid or has expired.")
        elif challenge.attempts >= MAX_OTP_ATTEMPTS:
            failure = _otp_locked()
        elif challenge.expires_at <= timezone.now():
            challenge.consumed_at = timezone.now()
            challenge.save(update_fields=["consumed_at", "updated_at"])
            failure = ServiceError("OTP_INVALID", "The code is invalid or has expired.")
        elif not hmac.compare_digest(
            challenge.code_hash,
            _otp_hash(challenge.pk, code.strip()),
        ):
            challenge.attempts += 1
            challenge.save(update_fields=["attempts", "updated_at"])
            failure = (
                _otp_locked()
                if challenge.attempts >= MAX_OTP_ATTEMPTS
                else ServiceError("OTP_INVALID", "The code is invalid or has expired.")
            )
        else:
            challenge.consumed_at = timezone.now()
            challenge.save(update_fields=["consumed_at", "updated_at"])
            verified = challenge
    if failure is not None:
        raise failure
    if verified is None:  # pragma: no cover - defensive invariant
        raise ServiceError("OTP_INVALID", "The code is invalid or has expired.")
    return verified


def enable_login_otp(
    tenant: Tenant,
    *,
    actor: User,
    code: str,
    request: HttpRequest | None,
) -> None:
    verify_account_otp(
        tenant,
        user=actor,
        purpose=AccountOtp.Purpose.LOGIN_ENABLE,
        code=code,
    )
    with transaction.atomic():
        user = User.objects.select_for_update().get(tenant=tenant, pk=actor.pk)
        user.login_otp_required = True
        user.save(update_fields=["login_otp_required", "updated_at"])
        audit(
            tenant,
            actor=user,
            action="auth.login_otp.enable",
            target_type="user",
            target_id=user,
            request=request,
        )


@transaction.atomic
def disable_login_otp(
    tenant: Tenant,
    *,
    actor: User,
    current_password: str,
    request: HttpRequest | None,
) -> None:
    user = User.objects.select_for_update().get(tenant=tenant, pk=actor.pk)
    if not user.check_password(current_password):
        raise ServiceError("CURRENT_PASSWORD_INVALID", "Current password is incorrect.")
    user.login_otp_required = False
    user.save(update_fields=["login_otp_required", "updated_at"])
    audit(
        tenant,
        actor=user,
        action="auth.login_otp.disable",
        target_type="user",
        target_id=user,
        request=request,
    )


def _otp_hash(challenge_id: Any, code: str) -> str:
    message = f"{challenge_id}:{code}".encode()
    secret_key = cast("str", settings.SECRET_KEY)
    return hmac.new(secret_key.encode(), message, hashlib.sha256).hexdigest()


def _otp_template(purpose: AccountOtp.Purpose) -> str:
    templates: dict[AccountOtp.Purpose, str] = {
        AccountOtp.Purpose.PASSWORD_RESET: "password_reset",
        AccountOtp.Purpose.LOGIN: "login_otp",
        AccountOtp.Purpose.LOGIN_ENABLE: "login_otp_enable",
    }
    return templates[purpose]


def _otp_locked() -> ServiceError:
    return ServiceError("OTP_LOCKED", "Too many incorrect code attempts.", http_status=423)
