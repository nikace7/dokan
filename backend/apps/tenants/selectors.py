"""Read-side queries for tenants — the middleware's tenant lookup lives here."""

import logging
from typing import TYPE_CHECKING, Any, Final, Literal

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from apps.tenants.models import Branch, Tenant, TenantFeatureOverride

if TYPE_CHECKING:
    from uuid import UUID

    from django.db.models import QuerySet

    from apps.accounts.models import User

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS: Final = 300


def get_effective_plan_value(
    tenant: Tenant,
    namespace: Literal["features", "limits"],
    key: str,
) -> Any:
    """Resolve an unexpired tenant override before the tenant's plan JSON."""
    override = (
        TenantFeatureOverride.objects.filter(tenant=tenant, key=f"{namespace}.{key}")
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .first()
    )
    if override is not None:
        return override.value
    values = getattr(tenant.plan, namespace, {})
    return values.get(key) if isinstance(values, dict) else None


def is_feature_enabled(tenant: Tenant, key: str) -> bool:
    """Return true only for an explicit boolean plan feature value."""
    return get_effective_plan_value(tenant, "features", key) is True


def get_effective_plan_features(tenant: Tenant) -> dict[str, Any]:
    """Return plan features with every active tenant override applied."""
    values = tenant.plan.features
    features = dict(values) if isinstance(values, dict) else {}
    overrides = (
        TenantFeatureOverride.objects.filter(tenant=tenant, key__startswith="features.")
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .values_list("key", "value")
    )
    for key, value in overrides:
        features[key.removeprefix("features.")] = value
    return features


def _cache_key(slug: str) -> str:
    return f"tenant:slug:{slug}"


def invalidate_tenant_cache(slug: str) -> None:
    """Drop the cached tenant row for ``slug`` — call after any tenant write."""
    try:
        cache.delete(_cache_key(slug))
    except Exception:
        logger.warning("tenant cache delete failed", exc_info=True)


def get_tenant_by_slug(slug: str) -> Tenant | None:
    """Fetch a non-deleted tenant by slug, cached for 5 minutes.

    The cache is best-effort: if Redis is unavailable (dev machine without
    the compose stack), the lookup falls through to Postgres instead of
    failing the request.
    """
    key = _cache_key(slug)
    try:
        cached: Tenant | None = cache.get(key)
    except Exception:
        logger.warning("tenant cache get failed; falling back to Postgres", exc_info=True)
        cached = None
    if cached is not None:
        return cached

    tenant = Tenant.objects.filter(slug=slug, deleted_at__isnull=True).first()
    if tenant is not None:
        try:
            cache.set(key, tenant, _CACHE_TTL_SECONDS)
        except Exception:
            logger.warning("tenant cache set failed", exc_info=True)
    return tenant


def get_tenant_pk_by_slug(slug: str) -> "UUID | None":
    """Primary-key-only variant for hot paths that don't need the row."""
    tenant = get_tenant_by_slug(slug)
    return tenant.pk if tenant is not None else None


def get_tenant_settings(tenant: Tenant, user: "User") -> Tenant:
    """Return the current tenant profile for an explicit tenant read."""
    return tenant


def list_branches(
    tenant: "Tenant", user: "User", *, is_active: bool | None = None
) -> "QuerySet[Branch]":
    """List branch choices for the current tenant.

    ``user`` stays explicit to keep the selector contract consistent with
    tenant-scoped reads; branch-role filtering can be added here when
    branch-scoped permissions become enforceable.
    """
    qs = Branch.objects.filter(tenant=tenant)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    return qs.order_by("-is_default", "name", "code")
