"""Security-critical support-session lifecycle and token issuance."""

from datetime import timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.accounts.tokens import AUDIENCE_TENANT
from apps.notifications.services import queue_support_access_sms
from apps.platformadmin.audit import audit_platform
from apps.platformadmin.models import ImpersonationSession, PlatformUser
from apps.platformadmin.permissions import require_platform_role
from core.db.rls import set_local_tenant
from core.middleware.platform_admin import get_client_ip
from core.responses import ServiceError

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.tenants.models import Tenant

_DURATIONS = frozenset({15, 30, 60})
_REVOKED_KEY = "impersonation:revoked:{}"


def _token_for(session: ImpersonationSession, user: User) -> str:
    token = AccessToken.for_user(user)
    token.set_exp(
        from_time=session.started_at,
        lifetime=session.expires_at - session.started_at,
    )
    token["sub"] = str(user.pk)
    token["aud"] = AUDIENCE_TENANT
    token["tenant"] = str(session.tenant_id)
    token["act"] = str(session.platform_user_id)
    token["scope"] = session.scope.lower()
    token["token_use"] = "access"
    # ponytail: the session UUID is already unique, so it is also the token jti.
    token["jti"] = str(session.pk)
    return str(token)


def _owner_phones(tenant: "Tenant") -> list[str]:
    return list(
        User.objects.filter(
            tenant=tenant,
            is_active=True,
            user_roles__role__code="OWNER",
        )
        .values_list("phone", flat=True)
        .distinct()
    )


@transaction.atomic
def start_impersonation(
    tenant: "Tenant",
    *,
    actor: PlatformUser,
    target_user_id: UUID,
    reason: str,
    scope: str = ImpersonationSession.Scope.READ_ONLY,
    duration_minutes: int = 15,
    request: "HttpRequest | None" = None,
) -> tuple[ImpersonationSession, str]:
    """Open one support session and return its tenant-audience access token."""
    require_platform_role(
        actor,
        (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.SUPPORT),
    )
    clean_reason = reason.strip()
    if len(clean_reason) < 20:
        raise ServiceError(
            "IMPERSONATION_REASON_INVALID",
            "A support-access reason of at least 20 characters is required.",
        )
    if duration_minutes not in _DURATIONS:
        raise ServiceError(
            "IMPERSONATION_DURATION_INVALID",
            "Support access must last 15, 30, or 60 minutes.",
        )
    if scope not in ImpersonationSession.Scope.values:
        raise ServiceError("IMPERSONATION_SCOPE_INVALID", "Unknown support-access scope.")
    if (
        scope == ImpersonationSession.Scope.READ_WRITE
        and actor.role != PlatformUser.Role.SUPER_ADMIN
    ):
        raise ServiceError(
            "IMPERSONATION_WRITE_FORBIDDEN",
            "Only a super admin can approve read/write support access.",
            http_status=403,
        )

    set_local_tenant(connection, tenant.pk)
    target = User.objects.filter(tenant=tenant, pk=target_user_id, is_active=True).first()
    if target is None:
        raise ServiceError(
            "IMPERSONATION_TARGET_NOT_FOUND",
            "The active target user was not found in this shop.",
            http_status=404,
        )
    owner_phones = _owner_phones(tenant)
    if not owner_phones:
        raise ServiceError(
            "OWNER_NOTIFICATION_UNAVAILABLE",
            "Support access requires an active shop owner who can be notified.",
            http_status=409,
        )

    now = timezone.now()
    session = ImpersonationSession.objects.create(
        platform_user=actor,
        tenant=tenant,
        target_user_id=target.pk,
        reason=clean_reason,
        scope=scope,
        ip=(get_client_ip(request) or None) if request else None,
        user_agent=request.META.get("HTTP_USER_AGENT") or None if request else None,
        expires_at=now + timedelta(minutes=duration_minutes),
    )
    expires_label = timezone.localtime(session.expires_at).strftime("%Y-%m-%d %H:%M %Z")
    for phone in owner_phones:
        queue_support_access_sms(
            tenant,
            to_phone=phone,
            platform_user_name=actor.full_name,
            expires_at=expires_label,
        )
    audit_platform(
        actor=actor,
        action="impersonation.start",
        tenant=tenant,
        payload={
            "session": str(session.pk),
            "target_user": str(target.pk),
            "scope": session.scope,
            "reason": session.reason,
            "expires_at": session.expires_at.isoformat(),
            "owner_notifications": len(owner_phones),
        },
        request=request,
    )
    return session, _token_for(session, target)


def _revoke(session: ImpersonationSession) -> None:
    remaining = max(1, int((session.expires_at - timezone.now()).total_seconds()))
    cache.set(_REVOKED_KEY.format(session.pk), True, timeout=remaining)


@transaction.atomic
def end_impersonation(
    session: ImpersonationSession,
    *,
    ended_by: UUID,
    audit_actor: PlatformUser,
    request: "HttpRequest | None" = None,
) -> ImpersonationSession:
    """End once; repeat calls are harmless and keep the first attribution."""
    locked = (
        ImpersonationSession.objects.select_for_update().select_related("tenant").get(pk=session.pk)
    )
    if locked.ended_at is None:
        locked.ended_at = timezone.now()
        locked.ended_by = ended_by
        locked.save(update_fields=["ended_at", "ended_by"])
        audit_platform(
            actor=audit_actor,
            action="impersonation.end",
            tenant=locked.tenant,
            payload={"session": str(locked.pk), "ended_by": str(ended_by)},
            request=request,
        )
        transaction.on_commit(lambda: _revoke(locked), robust=True)
    return locked


def assert_admin_can_end(actor: PlatformUser, session: ImpersonationSession) -> None:
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.SUPPORT))
    if actor.role != PlatformUser.Role.SUPER_ADMIN and session.platform_user_id != actor.pk:
        raise ServiceError(
            "IMPERSONATION_END_FORBIDDEN",
            "Support staff can end only their own sessions.",
            http_status=403,
        )


def impersonation_is_active(token: Any) -> bool:
    """Check Redis first, then durable session state for impersonated requests only."""
    jti = token.get("jti")
    if not jti or cache.get(_REVOKED_KEY.format(jti)):
        return False
    return ImpersonationSession.objects.filter(
        pk=jti,
        platform_user_id=token.get("act"),
        tenant_id=token.get("tenant"),
        target_user_id=token.get("sub"),
        ended_at__isnull=True,
        expires_at__gt=timezone.now(),
    ).exists()
