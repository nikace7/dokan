"""The audit log endpoint — owner-level read access.

``settings.manage`` gates it (owner-level); RLS already scopes rows to the
request tenant, so an owner sees exactly their own shop's trail.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import selectors
from apps.audit.serializers import AuditLogSerializer
from core.middleware.tenant import require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error


def _user(request: Request) -> Any:
    return request.user


def _uuid_param(request: Request, name: str) -> UUID | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _date_param(request: Request, name: str) -> Any:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        from datetime import date

        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ServiceError(
            "DATE_INVALID", f"Query parameter '{name}' must be an ISO date (YYYY-MM-DD)."
        ) from exc


class AuditLogListView(APIView):
    """GET /audit/ — filters: action, target_type, target_id, AD date range."""

    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = {"GET": "settings.manage"}

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_audit_log(
            tenant,
            _user(request),
            action=request.query_params.get("action", ""),
            target_type=request.query_params.get("target_type", ""),
            target_id=_uuid_param(request, "target_id"),
            date_from=_date_param(request, "date_from"),
            date_to=_date_param(request, "date_to"),
        )
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = AuditLogSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)
