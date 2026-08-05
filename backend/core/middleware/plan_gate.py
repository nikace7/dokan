"""Plan feature gating above the permission layers.

Contract (docs/SYSTEM_DESIGN.md §2.5, §8.5):

- ``PlanGate`` sits ABOVE the four permission enforcement layers: a
  permission the tenant's plan doesn't include is never granted, even to the
  owner.
- Feature flags: route returns 402 with a machine-readable code; the UI
  hides/locks the nav item.
- Enforcement never breaks a shop mid-sale: creation limits hard-block at
  create; volume limits (invoices/month) warn at 80%/100% but keep billing
  working; storage blocks new uploads but keeps existing files readable.
- Resolution order: ``tenant_feature_override`` (with expiry) →
  ``plan.features`` / ``plan.limits``.

"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final

from django.http import JsonResponse

from apps.tenants.selectors import is_feature_enabled
from apps.tenants.services import get_usage_warning
from core.middleware.tenant import get_request_tenant

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponse

_USAGE_KEY_ATTR: Final = "_plan_usage_key"


def _error_response(code: str, message: str) -> JsonResponse:
    return JsonResponse(
        {"data": None, "error": {"code": code, "message": message}},
        status=402,
    )


class PlanGateMiddleware:
    """Gate declared view features and add non-blocking volume warnings."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        tenant = get_request_tenant(request)
        usage_key = getattr(request, _USAGE_KEY_ATTR, None)
        if tenant is not None and usage_key and response.status_code < 400:
            warning = get_usage_warning(tenant, usage_key)
            if warning is not None:
                code, usage, limit = warning
                response["X-Plan-Usage-Warning"] = code
                response["X-Plan-Usage"] = str(usage)
                response["X-Plan-Limit"] = str(limit)
        return response

    def process_view(
        self,
        request: HttpRequest,
        view_func: Any,
        view_args: tuple[Any, ...],
        view_kwargs: dict[str, Any],
    ) -> JsonResponse | None:
        """Read plan declarations from the resolved DRF view class."""
        del view_args, view_kwargs
        tenant = get_request_tenant(request)
        view_class = getattr(view_func, "view_class", None)
        if tenant is None or view_class is None:
            return None

        feature_map = getattr(view_class, "plan_features_by_method", {})
        required = feature_map.get(request.method, ())
        features = (required,) if isinstance(required, str) else tuple(required)
        for feature in features:
            if not is_feature_enabled(tenant, feature):
                return _error_response(
                    "PLAN_FEATURE_REQUIRED",
                    "This feature is not included in your current plan. Upgrade to use it.",
                )

        usage_map = getattr(view_class, "plan_usage_by_method", {})
        usage_key = usage_map.get(request.method)
        if usage_key:
            setattr(request, _USAGE_KEY_ATTR, usage_key)
        return None
