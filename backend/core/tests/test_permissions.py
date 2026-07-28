"""Tests for core/permissions/base.py — route-layer permission gate."""

from typing import Any

import pytest
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import ImproperlyConfigured
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from core.permissions.base import HasPermission


def _request_with_user(user: Any) -> Any:
    request = APIRequestFactory().get("/")
    request.user = user
    return request


class _ViewWithoutCodename(APIView):
    permission_classes = [HasPermission]


class _ViewWithCodename(APIView):
    permission_classes = [HasPermission]
    required_permission = "sale.create"


def test_missing_codename_fails_closed() -> None:
    request = _request_with_user(AnonymousUser())
    with pytest.raises(ImproperlyConfigured, match="Failing closed"):
        HasPermission().has_permission(request, _ViewWithoutCodename())


def test_anonymous_user_denied() -> None:
    request = _request_with_user(AnonymousUser())
    assert not HasPermission().has_permission(request, _ViewWithCodename())


class _StubUser:
    is_authenticated = True

    def __init__(self, allowed: bool) -> None:
        self.allowed = allowed

    def has_perm(self, codename: str) -> bool:
        assert codename == "sale.create"
        return self.allowed


def test_user_with_permission_allowed() -> None:
    request = _request_with_user(_StubUser(allowed=True))
    assert HasPermission().has_permission(request, _ViewWithCodename())


def test_user_without_permission_denied() -> None:
    request = _request_with_user(_StubUser(allowed=False))
    assert not HasPermission().has_permission(request, _ViewWithCodename())
