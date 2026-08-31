"""Executable API-contract requirements from ADR 0002."""

from dataclasses import dataclass
from typing import Any

import pytest
from django.conf import settings
from drf_spectacular.drainage import GENERATOR_STATS
from drf_spectacular.generators import SchemaGenerator


@dataclass(frozen=True)
class GeneratedContract:
    schema: dict[str, Any]
    warnings: tuple[str, ...]
    errors: tuple[str, ...]


@pytest.fixture(scope="module")
def contract() -> GeneratedContract:
    schema = SchemaGenerator().get_schema(request=None, public=True)
    assert schema is not None
    return GeneratedContract(
        schema=schema,
        warnings=tuple(GENERATOR_STATS._warn_cache),
        errors=tuple(GENERATOR_STATS._error_cache),
    )


def test_schema_is_openapi_31(contract: GeneratedContract) -> None:
    assert settings.SPECTACULAR_SETTINGS["OAS_VERSION"] == "3.1.0"
    assert contract.schema["openapi"] == "3.1.0"


def test_schema_generation_has_no_warnings_or_errors(contract: GeneratedContract) -> None:
    assert contract.errors == ()
    assert contract.warnings == ()


def test_both_jwt_realms_are_documented(contract: GeneratedContract) -> None:
    schemes = contract.schema["components"]["securitySchemes"]

    assert schemes["TenantBearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Tenant JWT bound to the shop subdomain.",
    }
    assert schemes["PlatformBearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Platform-admin JWT accepted only on the admin host.",
    }


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/api/v1/sales", "post"),
        ("/api/v1/sales/hold", "post"),
        ("/api/v1/sales/returns", "post"),
        ("/api/v1/sales/exchanges", "post"),
        ("/api/v1/payments/receipts", "post"),
        ("/api/v1/payments/supplier-payments", "post"),
        ("/api/v1/payments/{id}/reverse", "post"),
    ],
)
def test_idempotent_writes_require_header(
    contract: GeneratedContract, path: str, method: str
) -> None:
    parameters = contract.schema["paths"][path][method]["parameters"]
    header = next(parameter for parameter in parameters if parameter["name"] == "Idempotency-Key")

    assert header["in"] == "header"
    assert header["required"] is True
    assert header["schema"] == {"type": "string", "minLength": 1, "maxLength": 255}


def test_operation_ids_are_unique(contract: GeneratedContract) -> None:
    operation_ids = [
        operation["operationId"]
        for path_item in contract.schema["paths"].values()
        for method, operation in path_item.items()
        if method in {"get", "post", "put", "patch", "delete"}
    ]

    assert len(operation_ids) == len(set(operation_ids))


def test_standard_envelopes_are_components(contract: GeneratedContract) -> None:
    schemas = contract.schema["components"]["schemas"]

    assert schemas["ApiError"]["required"] == ["code", "message"]
    assert schemas["ErrorEnvelope"]["properties"]["error"] == {
        "$ref": "#/components/schemas/ApiError"
    }
    assert schemas["PageMeta"]["required"] == ["count", "page", "page_size", "total_pages"]
