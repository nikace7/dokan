"""Public storefront endpoints — anonymous, host-resolved, plan-gated.

The shopfront host (``<sub>.shop.<root>``) is the only tenant source, in
the spirit of invariant 4: TenantMiddleware deliberately ignores nested
hosts, so these views resolve the tenant themselves from
``shopfront_subdomain`` and open their own RLS context per request.
"""

from typing import TYPE_CHECKING, Any, Protocol, cast

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.storefront import selectors
from apps.storefront.serializers import PublicProductSerializer
from apps.storefront.throttles import StorefrontThrottle
from apps.tenants.constants import TenantStatus
from apps.tenants.models import Branch, Tenant
from apps.tenants.services import require_plan_feature
from core.db.rls import set_local_tenant
from core.pagination import EnvelopePageNumberPagination
from core.responses import ServiceError, error, ok

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable


def resolve_shopfront_tenant(request: Request) -> Tenant:
    """Resolve + vet the shop behind a shopfront host (404/402 on failure)."""
    label = selectors.extract_shopfront_label(request.get_host(), str(settings.ROOT_DOMAIN))
    tenant = selectors.get_tenant_by_shopfront(label) if label else None
    if tenant is None or tenant.status not in TenantStatus.ACTIVE_STATUSES:
        raise ServiceError(
            "SHOPFRONT_NOT_FOUND", "We could not find this online store.", http_status=404
        )
    if (
        tenant.status == TenantStatus.TRIAL
        and tenant.trial_ends_at is not None
        and tenant.trial_ends_at <= timezone.now()
    ):
        raise ServiceError(
            "SHOPFRONT_INACTIVE", "This online store is not available right now.", http_status=402
        )
    require_plan_feature(tenant, "ecommerce")
    return tenant


class _StorefrontView(APIView):
    """Base: no auth, public throttle, ServiceError → envelope, tenant context."""

    authentication_classes: tuple = ()
    permission_classes = (AllowAny,)
    throttle_classes = (StorefrontThrottle,)

    _shop_tenant: Tenant

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def initial(self, request: Request, *args: object, **kwargs: object) -> None:
        super().initial(request, *args, **kwargs)
        self._shop_tenant = resolve_shopfront_tenant(request)

    def in_tenant_context(self, build: "Callable[[], Response]") -> Response:
        with transaction.atomic():
            set_local_tenant(connection, self._shop_tenant.pk)
            return build()


class _CountedCategory(Protocol):
    """Shape of Category rows carrying the product_count annotation."""

    pk: Any
    name: str
    name_np: str | None
    product_count: int


class _StorefrontPagination(EnvelopePageNumberPagination):
    page_size = 24

    def get_page_size(self, request: Request) -> int:
        # Fixed page size for the public grid — no client-tunable limit.
        return self.page_size or 24


class StorefrontSiteView(_StorefrontView):
    """GET /storefront/site — shop identity, template, contact, and nav categories."""

    def get(self, request: Request) -> Response:
        def build() -> Response:
            tenant = self._shop_tenant
            branch = Branch.objects.filter(tenant=tenant, is_default=True).first()
            counted = cast("Iterable[_CountedCategory]", selectors.public_categories(tenant))
            categories = [
                {
                    "id": str(c.pk),
                    "name": c.name,
                    "name_np": c.name_np,
                    "product_count": c.product_count,
                }
                for c in counted
                if c.product_count > 0
            ]
            return ok(
                {
                    "shop_name": tenant.name,
                    "shop_name_np": tenant.name_np,
                    "currency": tenant.currency,
                    "template": tenant.shopfront_template,
                    "contact": {
                        "phone": branch.phone if branch else None,
                        "address": branch.address if branch else None,
                    },
                    "categories": categories,
                }
            )

        return self.in_tenant_context(build)


class StorefrontProductListView(_StorefrontView):
    """GET /storefront/products — paged public catalog grid (cost-free payload)."""

    def get(self, request: Request) -> Response:
        def build() -> Response:
            products = selectors.public_products(
                self._shop_tenant,
                category_id=request.query_params.get("category"),
                q=request.query_params.get("q"),
            )
            paginator = _StorefrontPagination()
            page = paginator.paginate_queryset(products, request, view=self)
            serializer = PublicProductSerializer(page, many=True)
            return paginator.get_paginated_response(cast("list[Any]", serializer.data))

        return self.in_tenant_context(build)
