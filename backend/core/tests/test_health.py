"""Deployment readiness endpoint tests."""

from unittest.mock import patch

import pytest
from django.db import OperationalError
from django.test import Client

pytestmark = pytest.mark.django_db


def test_health_reports_database_and_cache_readiness() -> None:
    response = Client().get("/api/health", headers={"host": "app.dokan.com.np"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "cache": "ok"}


def test_health_hides_dependency_errors() -> None:
    with patch("core.views.connection.cursor", side_effect=OperationalError("secret host")):
        response = Client().get("/api/health", headers={"host": "app.dokan.com.np"})

    assert response.status_code == 503
    assert response.json() == {"status": "unhealthy"}
    assert b"secret host" not in response.content
