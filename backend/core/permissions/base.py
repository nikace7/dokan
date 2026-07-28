"""Base DRF permission — layer 1 (route) of the four enforcement layers.

The four deliberately redundant layers (docs/SYSTEM_DESIGN.md §8.5):

1. Route — this class, in a view's ``permission_classes``.
2. Serializer field — e.g. cost fields dropped without ``pricing.view_cost``.
3. Service — business rules (price floor, credit limit, discount cap).
4. Queryset/selector — branch scoping and column selection.

``PlanGate`` (core/middleware/plan_gate.py) sits above all four.

Codenames come from the permission catalog (``sale.create``,
``pricing.view_cost``, …). The catalog table and the auth backend that
resolves ``user.has_perm()`` against tenant roles land with
``apps.accounts``; until then this class still enforces authentication and a
real ``has_perm`` call, so no route is accidentally open.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

from django.core.exceptions import ImproperlyConfigured
from rest_framework.permissions import BasePermission

if TYPE_CHECKING:
    from django.http import HttpRequest
    from rest_framework.views import APIView


class HasPermission(BasePermission):
    """Require one permission codename, read from the view.

    Set ``required_permission = "sale.create"`` on the view (or subclass
    with ``permission_codename``). Fails closed: a view that forgets the
    codename raises ImproperlyConfigured instead of allowing access.
    """

    permission_codename: ClassVar[str | None] = None

    def _resolve_codename(self, view: APIView) -> str:
        codename = getattr(view, "required_permission", None) or self.permission_codename
        if not codename:
            msg = (
                f"{type(view).__name__} uses HasPermission but sets no "
                "'required_permission' codename. Failing closed."
            )
            raise ImproperlyConfigured(msg)
        return str(codename)

    def has_permission(self, request: HttpRequest, view: APIView) -> bool:
        codename = self._resolve_codename(view)
        user = request.user
        if user is None or not user.is_authenticated:
            return False
        return bool(user.has_perm(codename))
