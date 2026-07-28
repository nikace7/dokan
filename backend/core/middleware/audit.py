"""Audit middleware — request-scoped audit context (STRUCTURAL STUB).

Contract (docs/SYSTEM_DESIGN.md §8.6):

- The audit log is written by explicit ``audit(...)`` calls inside services —
  never by signals.
- This middleware's only job is to capture the request-scoped context those
  calls need — request id, IP, user agent, authenticated user id, and the
  impersonator (``act`` claim) when a support session is active — into a
  context variable that ``apps.audit.services.audit()`` reads.
- Audit rows are append-only; the DB role is revoked UPDATE/DELETE on
  ``audit_log``.

It is intentionally NOT registered in ``settings.MIDDLEWARE``: it activates
together with the ``apps.audit`` feature. Registering this stub raises
immediately so the gap is loud, not silent.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponse


class AuditContextMiddleware:
    """Capture request context for service-layer audit() calls.

    Not implemented: lands with the apps.audit feature (needs the audit_log
    model and the impersonation token claims from apps.accounts).
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        raise NotImplementedError(
            "AuditContextMiddleware is a structural stub; it activates with "
            "the apps.audit feature. Do not register it in MIDDLEWARE yet."
        )
