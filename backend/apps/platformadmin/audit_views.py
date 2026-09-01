"""Platform audit HTTP adapter."""

from typing import Any, ClassVar

from rest_framework.request import Request
from rest_framework.response import Response

from apps.platformadmin import selectors
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.serializers import PlatformAuditSerializer
from apps.platformadmin.views import _actor, _optional_uuid, _paginated, _PlatformAPIView
from core.openapi import operation


class PlatformAuditListView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": (PlatformUser.Role.SUPER_ADMIN,)
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=PlatformAuditSerializer,
            response_many=True,
            paginated=True,
        ),
    }

    def get(self, request: Request) -> Response:
        queryset = selectors.list_platform_audit(
            _actor(request),
            tenant_id=_optional_uuid(request.query_params.get("tenant"), "tenant"),
            action=request.query_params.get("action", "").strip(),
            platform_user_id=_optional_uuid(
                request.query_params.get("platform_user"), "platform_user"
            ),
        )
        return _paginated(request, self, queryset, PlatformAuditSerializer)
