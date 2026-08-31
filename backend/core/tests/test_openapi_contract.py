"""Executable API-contract requirements from ADR 0002."""

import ast
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from django.conf import settings
from drf_spectacular.drainage import GENERATOR_STATS
from drf_spectacular.generators import SchemaGenerator

from core.error_codes import API_ERROR_CODES


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
        ("/api/v1/storefront/orders", "post"),
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


def test_error_codes_are_published_as_a_stable_enum(contract: GeneratedContract) -> None:
    schemas = contract.schema["components"]["schemas"]
    code_schema = schemas["ApiError"]["properties"]["code"]
    enum_ref = code_schema["allOf"][0]["$ref"]
    enum_component = enum_ref.rsplit("/", 1)[-1]

    assert enum_ref.startswith("#/components/schemas/")
    assert schemas[enum_component]["enum"] == list(API_ERROR_CODES)
    assert len(API_ERROR_CODES) == len(set(API_ERROR_CODES))
    assert list(API_ERROR_CODES) == sorted(API_ERROR_CODES)


def test_schema_generation_is_repeatable() -> None:
    second_schema = SchemaGenerator().get_schema(request=None, public=True)

    assert second_schema is not None
    assert second_schema["components"]["schemas"]["ApiErrorCode"]["enum"] == list(API_ERROR_CODES)


def test_literal_error_codes_are_registered() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    code_argument_by_call = {
        "AuthenticationFailed": 1,
        "AuthError": 0,
        "PlatformAuthError": 0,
        "PermissionDenied": 1,
        "ServiceError": 0,
        "_error": 1,
        "error": 1,
    }
    discovered: set[str] = set()

    for source_root in (backend_root / "apps", backend_root / "core"):
        for source_path in source_root.rglob("*.py"):
            if "tests" in source_path.parts or "migrations" in source_path.parts:
                continue
            tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                call_name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
                if call_name not in code_argument_by_call:
                    continue
                keyword = next((item.value for item in node.keywords if item.arg == "code"), None)
                argument_index = code_argument_by_call[call_name]
                positional = node.args[argument_index] if len(node.args) > argument_index else None
                candidate = keyword or positional
                if isinstance(candidate, ast.Constant) and isinstance(candidate.value, str):
                    discovered.add(candidate.value)

    assert discovered <= set(API_ERROR_CODES), sorted(discovered - set(API_ERROR_CODES))


def test_every_operation_documents_machine_readable_errors(contract: GeneratedContract) -> None:
    for path_item in contract.schema["paths"].values():
        for method, operation_schema in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            error_schema = operation_schema["responses"]["default"]["content"]["application/json"][
                "schema"
            ]
            assert error_schema == {"$ref": "#/components/schemas/ErrorEnvelope"}
