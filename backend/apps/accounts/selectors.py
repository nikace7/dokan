"""Read-side queries for accounts — permission resolution and user lookups."""

import logging
from typing import TYPE_CHECKING, Final

from django.core.cache import cache

from apps.accounts.models import Role, RolePermission, User, UserRole

if TYPE_CHECKING:
    from django.db.models import QuerySet

    from apps.tenants.models import Tenant

if TYPE_CHECKING:
    from apps.accounts.models import User

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS: Final = 300


def _cache_key(user_pk: object) -> str:
    return f"user:perms:{user_pk}"


def invalidate_permission_cache(user_pk: object) -> None:
    """Drop a user's cached permission set.

    MUST be called after any user_role or role_permission write affecting
    this user (docs/SYSTEM_DESIGN.md §8.5: permission changes take effect
    within minutes, not at token expiry).
    """
    try:
        cache.delete(_cache_key(user_pk))
    except Exception:
        logger.warning("permission cache delete failed", exc_info=True)


def get_permission_codes(user: "User") -> frozenset[str]:
    """All permission codenames granted to a user via their roles.

    Resolved through user_role → role_permission → permission and cached for
    5 minutes (graceful Postgres fallback when Redis is unavailable).
    """
    key = _cache_key(user.pk)
    try:
        cached: frozenset[str] | None = cache.get(key)
    except Exception:
        logger.warning("permission cache get failed; hitting Postgres", exc_info=True)
        cached = None
    if cached is not None:
        return cached

    role_ids = UserRole.objects.filter(user_id=user.pk).values_list("role_id", flat=True)
    codes = frozenset(
        RolePermission.objects.filter(role_id__in=role_ids).values_list("permission_id", flat=True)
    )
    try:
        cache.set(key, codes, _CACHE_TTL_SECONDS)
    except Exception:
        logger.warning("permission cache set failed", exc_info=True)
    return codes


def list_roles(tenant: "Tenant", user: "User") -> "QuerySet[Role]":
    """List roles and their permissions for the current tenant."""
    return (
        Role.objects.filter(tenant=tenant)
        .prefetch_related("role_permissions__permission")
        .order_by("-is_system", "name", "code")
    )


def list_staff(tenant: "Tenant", user: "User") -> "QuerySet[User]":
    """List tenant staff with their assigned roles and optional branches."""
    return (
        User.objects.filter(tenant=tenant)
        .prefetch_related("user_roles__role", "user_roles__branch")
        .order_by("full_name", "phone")
    )
