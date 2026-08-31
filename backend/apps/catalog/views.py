"""DRF views for catalog — thin: parse, authorize, delegate.

Permissions: ``catalog.view`` for reads, ``catalog.manage`` for writes
(enforced per-method via core.permissions.HasPermission). All responses use
the API envelope; list endpoints paginate via EnvelopePageNumberPagination.
Variant/lookup/quick-create views live in ``views_variants.py``.
"""

from typing import Any, ClassVar
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog import selectors, services
from apps.catalog.models import Brand, Category, Item, SizeChart
from apps.catalog.serializers import (
    BrandSerializer,
    CategorySerializer,
    ItemSerializer,
    SizeChartSerializer,
)
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, not_found_code, ok

_METHOD_PERMISSIONS: dict[str, str] = {
    "GET": "catalog.view",
    "POST": "catalog.manage",
    "PATCH": "catalog.manage",
    "DELETE": "catalog.manage",
}


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


def _get_or_404(tenant: Any, model: Any, pk: UUID, what: str) -> Any:
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


class _CatalogAPIView(APIView):
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

    def _is_active_param(self, request: Request) -> bool | None:
        raw = request.query_params.get("is_active")
        if raw is None:
            return None
        return raw.lower() in {"1", "true", "yes"}


class CategoryListView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=CategorySerializer, response_many=True, paginated=True),
        "POST": operation(
            request=CategorySerializer,
            response=CategorySerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_categories(
            tenant,
            _user(request),
            is_active=self._is_active_param(request),
            search=request.query_params.get("search", ""),
        )
        return self._paginated(request, qs, CategorySerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = CategorySerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        category = services.create_category(tenant, **serializer.validated_data)
        return ok(
            CategorySerializer(category, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class CategoryDetailView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=CategorySerializer),
        "PATCH": operation(request=CategorySerializer, response=CategorySerializer),
        "DELETE": operation(),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        category = _get_or_404(tenant, Category, pk, "Category")
        return ok(CategorySerializer(category, context=self._context(request)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        category = _get_or_404(tenant, Category, pk, "Category")
        serializer = CategorySerializer(
            category, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        category = services.update_category(tenant, category, **serializer.validated_data)
        return ok(CategorySerializer(category, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        category = _get_or_404(tenant, Category, pk, "Category")
        services.deactivate(category)
        return ok({"id": str(pk), "is_active": False})


class BrandListView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=BrandSerializer, response_many=True, paginated=True),
        "POST": operation(request=BrandSerializer, response=BrandSerializer, status_code=201),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_brands(
            tenant,
            _user(request),
            is_active=self._is_active_param(request),
            search=request.query_params.get("search", ""),
        )
        return self._paginated(request, qs, BrandSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = BrandSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        brand = services.create_brand(tenant, **serializer.validated_data)
        return ok(
            BrandSerializer(brand, context=self._context(request)).data, status.HTTP_201_CREATED
        )


class BrandDetailView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(request=BrandSerializer, response=BrandSerializer),
        "DELETE": operation(),
    }

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        brand = _get_or_404(tenant, Brand, pk, "Brand")
        serializer = BrandSerializer(
            brand, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        brand = services.update_brand(brand, **serializer.validated_data)
        return ok(BrandSerializer(brand, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        brand = _get_or_404(tenant, Brand, pk, "Brand")
        services.deactivate(brand)
        return ok({"id": str(pk), "is_active": False})


class SizeChartListView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=SizeChartSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=SizeChartSerializer,
            response=SizeChartSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_size_charts(tenant, _user(request))
        return self._paginated(request, qs, SizeChartSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = SizeChartSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        chart = services.create_size_chart(tenant, **serializer.validated_data)
        return ok(
            SizeChartSerializer(chart, context=self._context(request)).data, status.HTTP_201_CREATED
        )


class SizeChartDetailView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(request=SizeChartSerializer, response=SizeChartSerializer),
        "DELETE": operation(),
    }

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        chart = _get_or_404(tenant, SizeChart, pk, "Size chart")
        serializer = SizeChartSerializer(
            chart, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        chart = services.update_size_chart(chart, **serializer.validated_data)
        return ok(SizeChartSerializer(chart, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        chart = _get_or_404(tenant, SizeChart, pk, "Size chart")
        services.deactivate(chart)
        return ok({"id": str(pk), "is_active": False})


class ItemListView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ItemSerializer, response_many=True, paginated=True),
        "POST": operation(request=ItemSerializer, response=ItemSerializer, status_code=201),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_items(
            tenant,
            _user(request),
            category_id=_uuid_param(request, "category"),
            brand_id=_uuid_param(request, "brand"),
            is_active=self._is_active_param(request),
            search=request.query_params.get("search", ""),
        )
        return self._paginated(request, qs, ItemSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = ItemSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        item = services.create_item(tenant, created_by=_user(request), **serializer.validated_data)
        return ok(
            ItemSerializer(item, context=self._context(request)).data, status.HTTP_201_CREATED
        )


class ItemDetailView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ItemSerializer),
        "PATCH": operation(request=ItemSerializer, response=ItemSerializer),
        "DELETE": operation(),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        item = _get_or_404(tenant, Item, pk, "Item")
        return ok(ItemSerializer(item, context=self._context(request)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        item = _get_or_404(tenant, Item, pk, "Item")
        serializer = ItemSerializer(
            item, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        item = services.update_item(tenant, item, **serializer.validated_data)
        return ok(ItemSerializer(item, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        item = _get_or_404(tenant, Item, pk, "Item")
        services.deactivate(item)
        return ok({"id": str(pk), "is_active": False})


class ItemImageView(_CatalogAPIView):
    """POST/DELETE /catalog/items/{id}/image — one photo per item.

    Multipart upload, field name ``image``; the response is the item detail
    serializer (envelope) so the client sees the fresh ``image_url``. The
    default method map already gates POST/DELETE on ``catalog.manage``.
    """

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request={
                "multipart/form-data": {
                    "type": "object",
                    "required": ["image"],
                    "properties": {"image": {"type": "string", "format": "binary"}},
                }
            },
            response=ItemSerializer,
        ),
        "DELETE": operation(),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        item = _get_or_404(tenant, Item, pk, "Item")
        uploaded = request.FILES.get("image")
        if uploaded is None:
            raise ServiceError("IMAGE_REQUIRED", "Attach an image file as the 'image' field.")
        item = services.set_item_image(item, uploaded)
        return ok(ItemSerializer(item, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        item = _get_or_404(tenant, Item, pk, "Item")
        item = services.clear_item_image(item)
        return ok({"id": str(item.pk), "image_url": None})
