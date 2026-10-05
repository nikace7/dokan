"""Smoke test: the OpenAPI schema endpoint renders on a platform host.

Exercises the full request path (URL routing, TenantMiddleware passthrough,
drf-spectacular) without a database.
"""

import importlib

from django.test import Client, override_settings
from django.urls import clear_url_caches

import config.urls


def test_openapi_schema_renders() -> None:
    response = Client().get("/api/schema/", HTTP_HOST="dokan.com.np")
    assert response.status_code == 200
    assert b"mero-pasal.online API" in response.content


def test_docs_and_django_admin_are_not_served_in_production_mode() -> None:
    # prod.py sets API_DOCS_ENABLED = False; Django admin is not installed.
    def reload_urls() -> None:
        clear_url_caches()
        importlib.reload(config.urls)

    try:
        with override_settings(API_DOCS_ENABLED=False):
            reload_urls()
            for path in ("/api/schema/", "/api/docs/", "/django-admin/"):
                response = Client().get(path, HTTP_HOST="dokan.com.np")
                assert response.status_code == 404, path
    finally:
        reload_urls()  # outside the override, so later tests get the docs back
