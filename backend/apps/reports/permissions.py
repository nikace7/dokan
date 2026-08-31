"""App-specific permissions for report operations."""

from typing import Any

from rest_framework.permissions import BasePermission
from rest_framework.request import Request

from apps.reports.exports import required_report_permission


class ReportExportPermission(BasePermission):
    """Apply the permission belonging to the requested report at the route."""

    def has_permission(self, request: Request, view: Any) -> bool:
        del view
        user = request.user
        if not user or not user.is_authenticated:
            return False
        permission = required_report_permission(request.query_params.get("report", ""))
        return permission is None or user.has_perm(permission)
