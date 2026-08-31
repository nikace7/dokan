"""Tenant authentication, recovery OTPs, and registered-device sessions."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING, Any, Final, cast

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import AuthSession, User
from apps.audit.services import audit
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.tenants.models import Tenant

MAX_FAILED_LOGINS: Final = 5
LOCKOUT_DURATION: Final = timedelta(minutes=15)
SESSION_TOUCH_INTERVAL: Final = timedelta(minutes=5)


class AuthError(Exception):
    """Credential failure with a machine-readable API code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def authenticate_tenant_user(
    tenant: Tenant,
    phone: str,
    password: str,
    *,
    request: HttpRequest | None = None,
) -> User:
    """Verify credentials without completing an OTP-protected login."""
    invalid = AuthError("INVALID_CREDENTIALS", "Phone number or password is incorrect.")
    authenticated: User | None = None
    failure: AuthError | None = None
    with transaction.atomic():
        user = User.objects.select_for_update().filter(tenant=tenant, phone=phone.strip()).first()
        if user is None or not user.is_active:
            _audit_login_failure(tenant, user=None, reason="invalid_credentials", request=request)
            failure = invalid
        elif user.is_locked:
            _audit_login_failure(tenant, user=user, reason="account_locked", request=request)
            until = f" Try again after {user.locked_until:%H:%M}." if user.locked_until else ""
            failure = AuthError("ACCOUNT_LOCKED", f"Too many failed login attempts.{until}")
        elif not user.check_password(password):
            failure = _register_failure(tenant, user, invalid, request=request)
        else:
            authenticated = user
    if failure is not None:
        raise failure
    if authenticated is None:  # pragma: no cover - defensive invariant
        raise invalid
    return authenticated


def _register_failure(
    tenant: Tenant,
    user: User,
    error: AuthError,
    *,
    request: HttpRequest | None,
) -> AuthError:
    user.failed_login_count += 1
    update_fields = ["failed_login_count", "updated_at"]
    if user.failed_login_count >= MAX_FAILED_LOGINS:
        user.locked_until = timezone.now() + LOCKOUT_DURATION
        user.failed_login_count = 0
        update_fields.append("locked_until")
    user.save(update_fields=update_fields)
    _audit_login_failure(tenant, user=user, reason="invalid_credentials", request=request)
    return error


def _audit_login_failure(
    tenant: Tenant,
    *,
    user: User | None,
    reason: str,
    request: HttpRequest | None,
) -> None:
    audit(
        tenant,
        actor=user,
        action="auth.login.failed",
        target_type="user" if user else "tenant",
        target_id=user or tenant,
        after={"reason": reason},
        request=request,
    )


@transaction.atomic
def complete_login(
    tenant: Tenant,
    *,
    user: User,
    device_id: uuid.UUID | None,
    device_name: str,
    request: HttpRequest | None,
) -> AuthSession:
    """Mark credential success and register one active device session."""
    locked = User.objects.select_for_update().get(tenant=tenant, pk=user.pk)
    now = timezone.now()
    locked.failed_login_count = 0
    locked.locked_until = None
    locked.last_login = now
    locked.save(update_fields=["failed_login_count", "locked_until", "last_login", "updated_at"])
    resolved_device_id = device_id or uuid.uuid4()
    AuthSession.objects.filter(
        tenant=tenant,
        user=locked,
        device_id=resolved_device_id,
        revoked_at__isnull=True,
    ).update(revoked_at=now, updated_at=now)
    session = AuthSession.objects.create(
        tenant=tenant,
        user=locked,
        device_id=resolved_device_id,
        device_name=(device_name.strip() or "Unknown device")[:100],
        user_agent=_request_user_agent(request),
        ip=_request_ip(request),
        last_seen_at=now,
        expires_at=now + cast("timedelta", settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]),
    )
    audit(
        tenant,
        actor=locked,
        action="auth.login",
        target_type="auth_session",
        target_id=session,
        after={"device_name": session.device_name},
        request=request,
    )
    return session


def touch_session(session: AuthSession) -> None:
    """Bound write amplification while retaining useful last-seen metadata."""
    now = timezone.now()
    if session.last_seen_at <= now - SESSION_TOUCH_INTERVAL:
        AuthSession.objects.filter(pk=session.pk).update(last_seen_at=now, updated_at=now)


@transaction.atomic
def revoke_session(
    tenant: Tenant,
    *,
    actor: User,
    session_id: Any,
    request: HttpRequest | None,
    action: str = "auth.session.revoke",
) -> AuthSession:
    """Revoke one of the actor's registered sessions."""
    session = (
        AuthSession.objects.select_for_update()
        .filter(tenant=tenant, user=actor, pk=session_id)
        .first()
    )
    if session is None:
        raise ServiceError("SESSION_NOT_FOUND", "Device session not found.", http_status=404)
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at", "updated_at"])
        audit(
            tenant,
            actor=actor,
            action=action,
            target_type="auth_session",
            target_id=session,
            before={"revoked": False},
            after={"revoked": True, "device_name": session.device_name},
            request=request,
        )
    return session


@transaction.atomic
def revoke_other_sessions(
    tenant: Tenant,
    *,
    actor: User,
    current_session_id: Any,
    request: HttpRequest | None,
) -> int:
    now = timezone.now()
    sessions = AuthSession.objects.filter(
        tenant=tenant,
        user=actor,
        revoked_at__isnull=True,
    ).exclude(pk=current_session_id)
    count = sessions.update(revoked_at=now, updated_at=now)
    if count:
        audit(
            tenant,
            actor=actor,
            action="auth.session.revoke_others",
            target_type="user",
            target_id=actor,
            after={"revoked_count": count},
            request=request,
        )
    return count


def _request_ip(request: HttpRequest | None) -> str | None:
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR")


def _request_user_agent(request: HttpRequest | None) -> str:
    return (request.META.get("HTTP_USER_AGENT", "") if request else "")[:500]
