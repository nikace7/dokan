"""Smoke test: the OpenAPI schema endpoint renders on a platform host.

Exercises the full request path (URL routing, TenantMiddleware passthrough,
drf-spectacular) without a database.
"""

from django.test import Client


def test_openapi_schema_renders() -> None:
    response = Client().get("/api/schema/", HTTP_HOST="dokan.com.np")
    assert response.status_code == 200
    assert b"mero-pasal.online API" in response.content
