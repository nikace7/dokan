"""Brute-force protection for platform authentication endpoints."""

from typing import Any

from rest_framework.throttling import AnonRateThrottle

from core.middleware.platform_admin import get_client_ip


class PlatformAuthThrottle(AnonRateThrottle):
    scope = "platform_auth"
    rate = "20/min"

    def get_cache_key(self, request: Any, view: object) -> str | None:
        del view
        user = getattr(request, "user", None)
        if user and user.is_authenticated:
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": get_client_ip(request),
        }
