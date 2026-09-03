"""Ordering-facing storefront endpoints: product detail, OTP auth, checkout,
public tracking, and customer order history.

Same rules as ``views.py``: anonymous by default, host-resolved tenant,
plan-gated, ServiceError → envelope. The customer token (email-OTP login)
travels as ``Authorization: Bearer <token>`` and is validated per request —
it is a shopper credential, never a shop-staff one.
"""

from typing import TYPE_CHECKING, Any, ClassVar

from django.db.models import Sum
from rest_framework.request import Request
from rest_framework.response import Response

from apps.catalog.models import Item, ItemVariant
from apps.inventory.models import StockLevel
from apps.storefront import selectors, services_auth, services_orders
from apps.storefront.serializers_order import (
    CheckoutSerializer,
    OtpRequestSerializer,
    OtpVerifySerializer,
    order_payload,
)
from apps.storefront.throttles import StorefrontAuthThrottle
from apps.storefront.views import _StorefrontView
from core.openapi import object_list, operation
from core.responses import ServiceError, ok

if TYPE_CHECKING:
    from apps.storefront.models import StoreCustomer, StoreOrder


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    return header[7:] if header.startswith("Bearer ") else None


def _require_customer(request: Request, view: "_StorefrontView") -> "StoreCustomer":
    token = _bearer_token(request)
    customer = services_auth.resolve_customer_token(view._shop_tenant, token) if token else None
    if customer is None:
        raise ServiceError(
            "LOGIN_REQUIRED", "Please log in with your email code first.", http_status=401
        )
    return customer


class StorefrontProductDetailView(_StorefrontView):
    """GET /storefront/products/<id> — one product with its variant matrix."""

    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request, pk: str) -> Response:
        def build() -> Response:
            tenant = self._shop_tenant
            item = (
                Item.objects.filter(tenant=tenant, pk=pk, is_active=True, website_visible=True)
                .select_related("category", "brand")
                .first()
            )
            if item is None:
                raise ServiceError(
                    "PRODUCT_NOT_FOUND", "We could not find this product.", http_status=404
                )
            store = selectors.get_settings(tenant)
            price, compare_at, offer_pct = selectors.website_pricing(item, store)
            stock = dict(
                StockLevel.objects.filter(tenant=tenant, variant__item=item)
                .values_list("variant_id")
                .annotate(on_hand=Sum("qty_on_hand"))
            )
            variants = [
                {
                    "id": str(v.pk),
                    "size": v.size,
                    "color": v.color,
                    "sku": v.sku,
                    "in_stock": bool((stock.get(v.pk) or 0) > 0),
                    "price": str(price) if price is not None else None,
                    "compare_at": str(compare_at) if compare_at is not None else None,
                }
                for v in ItemVariant.objects.filter(
                    tenant=tenant, item=item, is_active=True
                ).order_by("size", "color")
            ]
            return ok(
                {
                    "id": str(item.pk),
                    "code": item.code,
                    "name": item.name,
                    "name_np": item.name_np,
                    "image": item.image.url if item.image else None,
                    "category": item.category.name if item.category else None,
                    "brand": item.brand.name if item.brand else None,
                    "website_price": str(price) if price is not None else None,
                    "website_compare_at": str(compare_at) if compare_at is not None else None,
                    "offer_pct": str(offer_pct) if offer_pct is not None else None,
                    "variants": variants,
                }
            )

        return self.in_tenant_context(build)


class StoreOtpRequestView(_StorefrontView):
    """POST /storefront/auth/otp — email a 6-digit login code."""

    throttle_classes = (StorefrontAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=OtpRequestSerializer),
    }

    def post(self, request: Request) -> Response:
        def build() -> Response:
            serializer = OtpRequestSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            services_auth.request_otp(self._shop_tenant, email=serializer.validated_data["email"])
            return ok({"sent": True})

        return self.in_tenant_context(build)


class StoreOtpVerifyView(_StorefrontView):
    """POST /storefront/auth/verify — trade a code for a 30-day customer token."""

    throttle_classes = (StorefrontAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=OtpVerifySerializer),
    }

    def post(self, request: Request) -> Response:
        def build() -> Response:
            serializer = OtpVerifySerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            customer = services_auth.verify_otp(
                self._shop_tenant,
                email=serializer.validated_data["email"],
                code=serializer.validated_data["code"],
            )
            return ok(
                {
                    "token": services_auth.issue_customer_token(customer),
                    "customer": {
                        "email": customer.email,
                        "full_name": customer.full_name,
                        "phone": customer.phone,
                    },
                }
            )

        return self.in_tenant_context(build)


class StoreOrderCreateView(_StorefrontView):
    """POST /storefront/orders — checkout. Idempotency-Key is mandatory."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=CheckoutSerializer,
            status_code=(200, 201),
            idempotent=True,
        ),
    }

    def post(self, request: Request) -> Response:
        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            raise ServiceError(
                "MISSING_IDEMPOTENCY_KEY",
                "The Idempotency-Key header is required.",
                http_status=400,
            )

        def build() -> Response:
            customer = _require_customer(request, self)
            serializer = CheckoutSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            order, created = services_orders.place_order(
                self._shop_tenant,
                customer=customer,
                customer_fields=data["customer"],
                fulfillment=data["fulfillment"],
                payment_method=data["payment_method"],
                address=data.get("address"),
                note=data["note"],
                lines=data["items"],
                idempotency_key=idempotency_key,
            )
            return ok(order_payload(order), 201 if created else 200)

        return self.in_tenant_context(build)


class StoreOrderTrackingView(_StorefrontView):
    """GET /storefront/orders/<tracking_token> — public order status."""

    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request, tracking_token: str) -> Response:
        def build() -> Response:
            order = self._order_by_token(tracking_token)
            return ok(order_payload(order))

        return self.in_tenant_context(build)

    def _order_by_token(self, tracking_token: str) -> "StoreOrder":
        from apps.storefront.models import StoreOrder

        order = (
            StoreOrder.objects.filter(tenant=self._shop_tenant, tracking_token=tracking_token)
            .prefetch_related("items")
            .first()
        )
        if order is None:
            raise ServiceError("ORDER_NOT_FOUND", "We could not find this order.", http_status=404)
        return order


class StoreMyOrdersView(_StorefrontView):
    """GET /storefront/my/orders — the logged-in shopper's order history."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=object_list()),
    }

    def get(self, request: Request) -> Response:
        def build() -> Response:
            customer = _require_customer(request, self)
            from apps.storefront.models import StoreOrder

            orders = (
                StoreOrder.objects.filter(tenant=self._shop_tenant, customer=customer)
                .prefetch_related("items")
                .order_by("-created_at")[:50]
            )
            return ok([order_payload(order) for order in orders])

        return self.in_tenant_context(build)
