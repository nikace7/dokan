"""Static reusable OpenAPI components safe to import from Django settings."""

from typing import Any

OPENAPI_COMPONENTS: dict[str, Any] = {
    "schemas": {
        "ApiError": {
            "type": "object",
            "required": ["code", "message"],
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Stable machine-readable error code.",
                },
                "message": {"type": "string"},
                "field": {"type": ["string", "null"]},
                "details": {"type": "object", "additionalProperties": True},
            },
        },
        "ErrorEnvelope": {
            "type": "object",
            "required": ["data", "error"],
            "properties": {
                "data": {"type": "null"},
                "error": {"$ref": "#/components/schemas/ApiError"},
            },
        },
        "PageMeta": {
            "type": "object",
            "required": ["count", "page", "page_size", "total_pages"],
            "properties": {
                "count": {"type": "integer", "minimum": 0},
                "page": {"type": "integer", "minimum": 1},
                "page_size": {"type": "integer", "minimum": 1, "maximum": 200},
                "total_pages": {"type": "integer", "minimum": 0},
            },
        },
    }
}
