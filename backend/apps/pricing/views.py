"""DRF views for pricing — thin: parse, authorize, delegate.

Permissions: ``pricing.view`` for reads, ``pricing.edit`` for writes,
``pricing.set_bounds`` for bound changes. All responses use the API
envelope; lists paginate via EnvelopePageNumberPagination.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import Category, Item, ItemVariant
from apps.pricing import selectors, services
from apps.pricing.models import RateType
from apps.pricing.serializers import (
    BoundsSerializer,
    ItemPriceSerializer,
    PriceChangeLogSerializer,
    RateTypeSerializer,
    SetPriceSerializer,
)
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, not_found_code, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "pricing.view",
    "POST": "pricing.edit",
    "PATCH": "pricing.edit",
    "DELETE": "pricing.edit",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _get_or_404(tenant: Any, model: Any, pk: Any, what: str) -> Any:
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError(not_found_code(what), f"{what} not found.", http_status=404)
    return instance


def _uuid_param(request: Request, name: str) -> UUID | None:
    """Parse a UUID query param; unparseable values mean 'no filter'."""
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _is_active_param(request: Request) -> bool | None:
    raw = request.query_params.get("is_active")
    if raw is None:
        return None
    return raw.lower() in {"1", "true", "yes"}


class _PricingAPIView(APIView):
    """Shared plumbing: envelope error conversion + serializer context."""

    permission_classes = (HasPermission,)
    method_permissions: ClassVar[dict[str, str]] = _METHOD_PERMISSIONS

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)

    def _context(self, request: Request) -> dict[str, Any]:
        return {"request": request, "user": _user(request)}

    def _paginated(self, request: Request, queryset: Any, serializer_class: Any) -> Response:
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(queryset, request, view=self)
        serializer = serializer_class(page, many=True, context=self._context(request))
        return paginator.get_paginated_response(serializer.data)


class RateTypeListView(_PricingAPIView):
    plan_features_by_method: ClassVar[dict[str, str]] = {"POST": "custom_rate_types"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=RateTypeSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=RateTypeSerializer,
            response=RateTypeSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_rate_types(tenant, _user(request), is_active=_is_active_param(request))
        return self._paginated(request, qs, RateTypeSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = RateTypeSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        rate_type = services.create_rate_type(
            tenant, user=_user(request), **serializer.validated_data
        )
        return ok(
            RateTypeSerializer(rate_type, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class RateTypeDetailView(_PricingAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(request=RateTypeSerializer, response=RateTypeSerializer),
        "DELETE": operation(),
    }

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        rate_type = _get_or_404(tenant, RateType, pk, "Rate type")
        serializer = RateTypeSerializer(
            rate_type, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        rate_type = services.update_rate_type(tenant, rate_type, **serializer.validated_data)
        return ok(RateTypeSerializer(rate_type, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        rate_type = _get_or_404(tenant, RateType, pk, "Rate type")
        services.deactivate_rate_type(rate_type)
        return ok({"id": str(pk), "is_active": False})


class ResolvePriceView(_PricingAPIView):
    """GET /pricing/resolve?variant=&rate_type= — the POS price check.

    rate_type is optional: the tenant default applies. The response never
    contains cost figures, regardless of permissions.
    """

    method_permissions: ClassVar[dict[str, str]] = {"GET": "pricing.view"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        variant_id = _uuid_param(request, "variant")
        if variant_id is None:
            return error(400, "VARIANT_REQUIRED", "Provide a variant query parameter.")
        variant = _get_or_404(tenant, ItemVariant, variant_id, "Variant")

        rate_type_id = _uuid_param(request, "rate_type")
        rate_type = (
            _get_or_404(tenant, RateType, rate_type_id, "Rate type")
            if rate_type_id
            else services.get_default_rate_type(tenant)
        )

        resolution = services.resolve_price(
            tenant, variant=variant, rate_type=rate_type, user=_user(request)
        )
        return ok(
            {
                "price": str(resolution.price),
                "source": resolution.source,
                "rate_type": str(rate_type.pk),
                "item_price": (
                    ItemPriceSerializer(resolution.item_price, context=self._context(request)).data
                    if resolution.item_price is not None
                    else None
                ),
            }
        )


class PriceListView(_PricingAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ItemPriceSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=SetPriceSerializer,
            response=ItemPriceSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_prices(
            tenant,
            _user(request),
            rate_type_id=_uuid_param(request, "rate_type"),
            scope=request.query_params.get("scope", ""),
        )
        return self._paginated(request, qs, ItemPriceSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = SetPriceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        rate_type = _get_or_404(tenant, RateType, data["rate_type"], "Rate type")
        targets: dict[str, Any] = {}
        for scope_fk, model, what in (
            ("variant", ItemVariant, "Variant"),
            ("item", Item, "Item"),
            ("category", Category, "Category"),
        ):
            if data.get(scope_fk):
                targets[scope_fk] = _get_or_404(tenant, model, data[scope_fk], what)

        item_price = services.set_price(
            tenant,
            rate_type=rate_type,
            scope=data["scope"],
            price=data["price"],
            effective_from=data["effective_from"],
            effective_to=data.get("effective_to"),
            reason=data.get("reason", ""),
            created_by=_user(request),
            **targets,
        )
        return ok(
            ItemPriceSerializer(item_price, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class PriceChangeListView(_PricingAPIView):
    """GET /pricing/changes — the append-only price change log.

    Readable with pricing.view: the log contains selling prices only (never
    cost), and shops need it to answer "who changed this rate and when".
    """

    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=PriceChangeLogSerializer, response_many=True, paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_price_changes(
            tenant,
            _user(request),
            target_type=request.query_params.get("target_type", ""),
            target_id=_uuid_param(request, "target"),
        )
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        context = {
            **self._context(request),
            "target_labels": selectors.price_change_target_labels(tenant, page or []),
        }
        serializer: Any = PriceChangeLogSerializer(page, many=True, context=context)
        return paginator.get_paginated_response(serializer.data)


class BoundsView(_PricingAPIView):
    """PATCH /pricing/bounds/<item|variant>/<id> — min/max bound changes."""

    method_permissions: ClassVar[dict[str, str]] = {"PATCH": "pricing.set_bounds"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(request=BoundsSerializer),
    }

    def patch(self, request: Request, target_kind: str, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        model = {"item": Item, "variant": ItemVariant}.get(target_kind)
        if model is None:
            return error(400, "TARGET_INVALID", "Target kind must be 'item' or 'variant'.")
        target = _get_or_404(tenant, model, pk, target_kind.capitalize())

        serializer = BoundsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        services.set_price_bounds(
            target=target,
            min_selling_price=data.get("min_selling_price"),
            max_selling_price=data.get("max_selling_price"),
            user=_user(request),
        )
        return ok({"id": str(pk), **BoundsSerializer(target).data})
