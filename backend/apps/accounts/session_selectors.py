"""Read paths for registered tenant-user device sessions."""

from typing import TYPE_CHECKING, Any

from django.db.models import QuerySet
from django.utils import timezone

from apps.accounts.models import AuthSession

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def active_session_for_token(
    tenant: "Tenant", *, session_id: Any, user_id: Any
) -> AuthSession | None:
    """Resolve a live session bound to the token user and request tenant."""
    return (
        AuthSession.objects.filter(
            tenant=tenant,
            pk=session_id,
            user_id=user_id,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .only("id", "last_seen_at")
        .first()
    )


def list_user_sessions(tenant: "Tenant", user: "User") -> QuerySet[AuthSession]:
    """Newest registered devices, including recently revoked entries."""
    return AuthSession.objects.filter(tenant=tenant, user=user).order_by("-created_at")[:50]
