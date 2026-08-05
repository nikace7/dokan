"""Role gates shared by platform-admin views and write services."""

from collections.abc import Iterable
from typing import Any, cast

from rest_framework.permissions import BasePermission
from rest_framework.request import Request

from apps.platformadmin.models import PlatformUser
from core.responses import ServiceError

ALL_PLATFORM_ROLES = (
    PlatformUser.Role.SUPER_ADMIN,
    PlatformUser.Role.SUPPORT,
    PlatformUser.Role.BILLING,
)


class PlatformRolePermission(BasePermission):
    """Authorize the current HTTP method against a view's role map."""

    def has_permission(self, request: Request, view: Any) -> bool:
        roles = getattr(view, "roles_by_method", {}).get(request.method, ())
        user = cast("PlatformUser", request.user)
        return bool(user.is_authenticated and user.role in roles)


def require_platform_role(actor: PlatformUser, allowed: Iterable[str]) -> None:
    """Defence-in-depth role check for every control-plane write service."""
    if not actor.is_active or actor.role not in allowed:
        raise ServiceError(
            "PLATFORM_ROLE_FORBIDDEN",
            "Your platform role cannot perform this action.",
            http_status=403,
        )
