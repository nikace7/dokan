"""Network and host boundary for the separate platform-admin API realm."""

from collections.abc import Callable
from ipaddress import ip_address, ip_network
from typing import Any, Final

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest, HttpResponse, JsonResponse

_ADMIN_PATH_PREFIX: Final = "/api/v1/admin/"


def _error(status: int, code: str, message: str) -> JsonResponse:
    return JsonResponse(
        {"data": None, "error": {"code": code, "message": message}},
        status=status,
    )


def get_client_ip(request: HttpRequest) -> str:
    """Return the right-most proxy-visible client address."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR", "")


def _is_allowed_ip(raw_ip: str, configured: list[Any]) -> bool:
    try:
        client = ip_address(raw_ip)
        networks = [ip_network(str(value), strict=False) for value in configured]
    except ValueError as exc:
        raise ImproperlyConfigured(
            "PLATFORM_ADMIN_ALLOWED_IPS contains an invalid IP or CIDR."
        ) from exc
    return any(client in network for network in networks)


class PlatformAdminBoundaryMiddleware:
    """Fail closed unless admin API traffic uses the admin host and allowlist."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if not request.path_info.startswith(_ADMIN_PATH_PREFIX):
            return self.get_response(request)

        hostname = request.get_host().split(":", 1)[0].lower().rstrip(".")
        if hostname != f"admin.{settings.ROOT_DOMAIN}".lower():
            return _error(404, "PLATFORM_HOST_REQUIRED", "This endpoint was not found.")

        allowed = list(settings.PLATFORM_ADMIN_ALLOWED_IPS)
        if not allowed or not _is_allowed_ip(get_client_ip(request), allowed):
            return _error(403, "PLATFORM_IP_FORBIDDEN", "This network cannot access the admin API.")
        return self.get_response(request)
