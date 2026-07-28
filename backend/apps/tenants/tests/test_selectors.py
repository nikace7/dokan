"""Selector tests for tenants — the middleware's cached tenant lookup."""

from typing import Any

import pytest

from apps.tenants.selectors import get_tenant_by_slug, invalidate_tenant_cache
from tests.factories import TenantFactory

pytestmark = pytest.mark.django_db


def test_lookup_miss_returns_none() -> None:
    assert get_tenant_by_slug("no-such-shop") is None


def test_lookup_hit_and_cache(django_assert_num_queries: Any) -> None:
    tenant = TenantFactory(slug="shreeganesh")

    # First call hits Postgres; second is served from cache (zero queries).
    first = get_tenant_by_slug("shreeganesh")
    assert first is not None and first.pk == tenant.pk
    with django_assert_num_queries(0):
        again = get_tenant_by_slug("shreeganesh")
        assert again is not None and again.pk == tenant.pk


def test_soft_deleted_tenant_is_not_resolved() -> None:
    from django.utils import timezone

    TenantFactory(slug="oldshop", deleted_at=timezone.now())
    assert get_tenant_by_slug("oldshop") is None


def test_invalidate_drops_cache(django_assert_num_queries: Any) -> None:
    TenantFactory(slug="cachedshop")
    assert get_tenant_by_slug("cachedshop") is not None
    invalidate_tenant_cache("cachedshop")
    with django_assert_num_queries(1):
        get_tenant_by_slug("cachedshop")
