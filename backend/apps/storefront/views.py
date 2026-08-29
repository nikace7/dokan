"""Public storefront endpoints — anonymous, host-resolved, plan-gated.

The shopfront host (``<sub>.shop.<root>``) is the only tenant source, in
the spirit of invariant 4: TenantMiddleware deliberately ignores nested
hosts, so these views resolve the tenant themselves from
``shopfront_subdomain`` and open their own RLS context per request.
"""

from typing import TYPE_CHECKING, Any, ClassVar, Protocol, cast

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.storefront import selectors, services
from apps.storefront.models import StoreSettings
from apps.storefront.serializers import PublicProductSerializer, StoreSettingsSerializer
from apps.storefront.throttles import StorefrontThrottle
from apps.tenants.constants import TenantStatus
from apps.tenants.models import Branch, Tenant
from apps.tenants.selectors import is_feature_enabled
from apps.tenants.services import require_plan_feature
from core.db.rls import set_local_tenant
from core.middleware.tenant import require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from apps.accounts.models import User


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
    throttle_classes: tuple[type[Any], ...] = (StorefrontThrottle,)

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
    """GET /storefront/site — shop identity, template, contact, store content, nav."""

    def get(self, request: Request) -> Response:
        def build() -> Response:
            tenant = self._shop_tenant
            branch = Branch.objects.filter(tenant=tenant, is_default=True).first()
            store = selectors.get_settings(tenant)
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
                    "currency": selectors.display_currency(tenant, store),
                    "template": tenant.shopfront_template,
                    "contact": {
                        "phone": branch.phone if branch else None,
                        "address": branch.address if branch else None,
                    },
                    "store": {
                        "hero_title": store.hero_title if store else "",
                        "hero_subtitle": store.hero_subtitle if store else "",
                        "announcement": store.announcement if store else "",
                        "offer_text": store.offer_text if store else "",
                        "offer_discount_pct": (
                            str(store.offer_discount_pct)
                            if store and store.offer_discount_pct is not None
                            else None
                        ),
                    },
                    "categories": categories,
                }
            )

        return self.in_tenant_context(build)


class StorefrontProductListView(_StorefrontView):
    """GET /storefront/products — paged public catalog grid (cost-free payload)."""

    def get(self, request: Request) -> Response:
        def build() -> Response:
            tenant = self._shop_tenant
            store = selectors.get_settings(tenant)
            context = {
                "display_currency": selectors.display_currency(tenant, store),
                "tenant_currency": tenant.currency,
                "discount_pct": store.offer_discount_pct if store else None,
            }
            products = selectors.public_products(
                tenant,
                category_id=request.query_params.get("category"),
                q=request.query_params.get("q"),
            )
            paginator = _StorefrontPagination()
            page = paginator.paginate_queryset(products, request, view=self)
            serializer = PublicProductSerializer(page, many=True, context=context)
            return paginator.get_paginated_response(cast("list[Any]", serializer.data))

        return self.in_tenant_context(build)


class StoreSettingsView(APIView):
    """GET/PATCH /storefront/settings — the tenant admin's website control panel.

    Returns the editable content alongside read-only platform decisions
    (address, template, plan gate) so the tenant UI can show the full picture
    of the online store from one payload.
    """

    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = {
        "GET": "settings.manage",
        "PATCH": "settings.manage",
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _payload(self, tenant: Tenant, settings_row: StoreSettings) -> dict[str, Any]:
        from apps.catalog.models import Item

        subdomain = tenant.shopfront_subdomain
        active_items = Item.objects.filter(tenant=tenant, is_active=True)
        return {
            **StoreSettingsSerializer(settings_row).data,
            "shopfront_subdomain": subdomain,
            "template": tenant.shopfront_template,
            "store_url": (
                f"https://{subdomain}.shop.{settings.ROOT_DOMAIN}" if subdomain else None
            ),
            "ecommerce_enabled": is_feature_enabled(tenant, "ecommerce"),
            # Setup-progress hints for the tenant UI checklist.
            "active_items_count": active_items.count(),
            "website_price_count": active_items.filter(website_price__isnull=False).count(),
        }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        return ok(self._payload(tenant, services.get_or_create_settings(tenant)))

    def patch(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = StoreSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        settings_row = services.update_settings(
            tenant,
            actor=cast("User", request.user),
            request=request,
            **serializer.validated_data,
        )
        return ok(self._payload(tenant, settings_row))
