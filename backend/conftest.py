"""Suite-wide pytest configuration."""

from typing import Any

import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_caches() -> Any:
    """Isolate cache state per test.

    Tenant lookups and permission sets are cached for 5 minutes; without a
    per-test clear, a cached row from one (rolled-back) test would leak into
    the next and resolve to a tenant that no longer exists.
    """
    cache.clear()
    yield
    cache.clear()
