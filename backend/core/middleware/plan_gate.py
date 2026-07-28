"""Plan gate middleware — feature gating above the permission layers (STUB).

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

It is intentionally NOT registered in ``settings.MIDDLEWARE``: it needs the
plan/subscription models from ``apps.tenants``. Registering this stub raises
immediately so the gap is loud, not silent.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponse


class PlanGateMiddleware:
    """Gate routes by the tenant's plan features and limits.

    Not implemented: lands after apps.tenants ships plan, subscription and
    tenant_feature_override models.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        raise NotImplementedError(
            "PlanGateMiddleware is a structural stub; it activates once "
            "apps.tenants provides plan/subscription models. Do not register "
            "it in MIDDLEWARE yet."
        )
