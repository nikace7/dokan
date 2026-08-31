"""OpenAPI contract primitives shared by every DRF view.

APIView is intentionally used throughout this project to keep views thin, but
drf-spectacular cannot infer its serializers.  Each operation therefore declares
an :class:`OperationContract`; this schema class turns those declarations into the
reviewable OpenAPI 3.1 contract required by ADR 0002.
"""

import re
from dataclasses import dataclass
from typing import Any, ClassVar

from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import Direction, OpenApiParameter
from rest_framework import serializers


@dataclass(frozen=True)
class OperationContract:
    """Request/response metadata for one HTTP method on an APIView."""

    request: Any = None
    response: Any = OpenApiTypes.OBJECT
    response_many: bool = False
    paginated: bool = False
    status_codes: tuple[int, ...] = (200,)
    idempotent: bool = False


def operation(
    *,
    request: Any = None,
    response: Any = OpenApiTypes.OBJECT,
    response_many: bool = False,
    paginated: bool = False,
    status_code: int | tuple[int, ...] = 200,
    idempotent: bool = False,
) -> OperationContract:
    """Build a concise, immutable schema declaration for a view method."""
    return OperationContract(
        request=request,
        response=response,
        response_many=response_many,
        paginated=paginated,
        status_codes=status_code if isinstance(status_code, tuple) else (status_code,),
        idempotent=idempotent,
    )


def object_list() -> dict[str, Any]:
    """Schema for selector rows that are intentionally dynamic dictionaries."""
    return {
        "type": "array",
        "items": {"type": "object", "additionalProperties": True},
    }


class ContractAutoSchema(AutoSchema):
    """Generate stable, envelope-aware operations from explicit view contracts."""

    _method_names: ClassVar[set[str]] = {"GET", "POST", "PUT", "PATCH", "DELETE"}

    def _contract(self) -> OperationContract | None:
        contracts = getattr(self.view, "schema_contract", {})
        return contracts.get(self.method)

    def get_request_serializer(self) -> Any:
        contract = self._contract()
        if contract is not None:
            return contract.request if contract.request is not None else OpenApiTypes.NONE
        return super().get_request_serializer()

    def get_response_serializers(self) -> Any:
        contract = self._contract()
        if contract is None:
            return super().get_response_serializers()

        response = contract.response
        if contract.response_many:
            if isinstance(response, type) and issubclass(response, serializers.BaseSerializer):
                response = response(many=True)
            elif isinstance(response, serializers.BaseSerializer):
                response = response.__class__(many=True)
        return {str(status_code): response for status_code in contract.status_codes}

    def get_override_parameters(self) -> list[Any]:
        parameters = list(super().get_override_parameters())
        contract = self._contract()
        if contract is not None and contract.idempotent:
            parameters.append(
                OpenApiParameter(
                    name="Idempotency-Key",
                    type={"type": "string", "minLength": 1, "maxLength": 255},
                    location=OpenApiParameter.HEADER,
                    required=True,
                    description="Unique key for safely replaying this write.",
                )
            )
        return parameters

    def get_operation_id(self) -> str:
        module_parts = self.view.__class__.__module__.split(".")
        app = module_parts[1] if len(module_parts) > 1 and module_parts[0] == "apps" else "core"
        view_name = re.sub(r"(?<!^)(?=[A-Z])", "_", self.view.__class__.__name__).lower()
        return f"{app}_{view_name}_{self.method.lower()}"

    def _get_response_bodies(self, direction: Direction = "response") -> dict[str, Any]:
        responses = super()._get_response_bodies(direction=direction)
        responses.setdefault(
            "default",
            {
                "description": "Machine-readable API error.",
                "content": {
                    "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
                },
            },
        )
        return responses

    def _get_response_for_code(
        self,
        serializer: Any,
        status_code: str,
        media_types: Any = None,
        direction: Direction = "response",
    ) -> dict[str, Any]:
        response = super()._get_response_for_code(
            serializer, status_code, media_types=media_types, direction=direction
        )
        if not status_code.startswith("2"):
            return response

        contract = self._contract()
        for media in response.get("content", {}).values():
            payload = media.get("schema", {})
            properties: dict[str, Any] = {
                "data": payload,
                "error": {"type": "null"},
            }
            required = ["data", "error"]
            if contract is not None and contract.paginated:
                properties["meta"] = {"$ref": "#/components/schemas/PageMeta"}
                required.append("meta")
            media["schema"] = {
                "type": "object",
                "required": required,
                "properties": properties,
            }
        return response


class TenantBearerScheme(OpenApiAuthenticationExtension):
    """Document the tenant-bound JWT realm."""

    target_class = "apps.accounts.authentication.TenantJWTAuthentication"
    name = "TenantBearerAuth"

    def get_security_definition(self, auto_schema: AutoSchema) -> dict[str, Any]:
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Tenant JWT bound to the shop subdomain.",
        }


class PlatformBearerScheme(OpenApiAuthenticationExtension):
    """Document the isolated platform-admin JWT realm."""

    target_class = "apps.platformadmin.authentication.PlatformJWTAuthentication"
    name = "PlatformBearerAuth"

    def get_security_definition(self, auto_schema: AutoSchema) -> dict[str, Any]:
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Platform-admin JWT accepted only on the admin host.",
        }
