"""Variant views — matrix entry, POS lookup hot paths, and quick-create.

Split from ``views.py`` to keep files under 400 lines; the shared plumbing
(``_CatalogAPIView``, ``_uuid_param``, ``_user``) lives in
``apps.catalog.views``.
"""

from typing import Any, ClassVar, cast
from uuid import UUID

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from apps.catalog import selectors, services, services_quick
from apps.catalog.models import Item, ItemVariant
from apps.catalog.serializers import (
    ItemSerializer,
    ItemVariantSerializer,
    QuickCreateProductSerializer,
    VariantBulkSerializer,
)
from apps.catalog.views import _CatalogAPIView, _user, _uuid_param
from apps.tenants.models import Branch
from core.middleware.tenant import require_request_tenant
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.responses import ServiceError, error, get_or_404, ok


class VariantListView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=ItemVariantSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=ItemVariantSerializer,
            response=ItemVariantSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_variants(
            tenant,
            _user(request),
            item_id=_uuid_param(request, "item"),
            is_active=self._is_active_param(request),
        )
        return self._paginated(request, qs, ItemVariantSerializer)

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        payload = request.data
        if not isinstance(payload, dict):
            raise ServiceError("ITEM_REQUIRED", "Provide a valid item id.")
        try:
            item_pk = UUID(str(payload.get("item")))
        except ValueError:
            raise ServiceError("ITEM_REQUIRED", "Provide a valid item id.") from None
        item = get_or_404(tenant, Item, item_pk, "Item")
        serializer = ItemVariantSerializer(data=request.data, context=self._context(request))
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        validated.pop("item", None)
        variant = services.create_variant(tenant, item=item, **validated)
        return ok(
            ItemVariantSerializer(variant, context=self._context(request)).data,
            status.HTTP_201_CREATED,
        )


class VariantDetailView(_CatalogAPIView):
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(request=ItemVariantSerializer, response=ItemVariantSerializer),
        "DELETE": operation(),
    }

    def patch(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        variant = get_or_404(tenant, ItemVariant, pk, "Variant")
        serializer = ItemVariantSerializer(
            variant, data=request.data, partial=True, context=self._context(request)
        )
        serializer.is_valid(raise_exception=True)
        variant = services.update_variant(variant, **serializer.validated_data)
        return ok(ItemVariantSerializer(variant, context=self._context(request)).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        variant = get_or_404(tenant, ItemVariant, pk, "Variant")
        services.deactivate(variant)
        return ok({"id": str(pk), "is_active": False})


class VariantBulkView(_CatalogAPIView):
    """POST /catalog/items/{id}/variants/bulk — the size × colour matrix."""

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=VariantBulkSerializer, status_code=201),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        item = get_or_404(tenant, Item, pk, "Item")
        serializer = VariantBulkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = services.bulk_create_variants(tenant, item=item, **serializer.validated_data)
        return ok(
            {
                "created_count": result["created_count"],
                "skipped_count": result["skipped_count"],
                "created": ItemVariantSerializer(
                    result["created"], many=True, context=self._context(request)
                ).data,
                "skipped": result["skipped"],
            },
            status.HTTP_201_CREATED,
        )


class QuickCreateProductView(_CatalogAPIView):
    """POST /catalog/products/quick-create — item + matrix + opening stock, one transaction.

    The simplified one-page "Add product" flow. Route gating is
    ``catalog.manage``; a payload with a ``stock`` block additionally
    requires ``stock.adjust`` because it posts OPENING inventory movements.
    """

    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=QuickCreateProductSerializer, status_code=201),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = QuickCreateProductSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = dict(serializer.validated_data)

        stock = validated.pop("stock", None)
        sizes = validated.pop("sizes")
        colors = validated.pop("colors")
        mrp = validated.pop("mrp", None)

        branch = None
        stock_rows: dict[str, Any] = {}
        unit_cost = None
        note = ""
        if stock is not None:
            if not _user(request).has_perm("stock.adjust"):
                raise ServiceError(
                    "PERMISSION_DENIED",
                    "Adding opening stock requires the stock.adjust permission.",
                    http_status=403,
                )
            branch = get_or_404(tenant, Branch, stock["branch"], "Branch")
            stock_rows = stock["quantities"]
            unit_cost = stock["unit_cost"]
            note = stock.get("note", "")

        result = services_quick.quick_create_product(
            tenant,
            created_by=_user(request),
            sizes=sizes,
            colors=colors,
            mrp=mrp,
            branch=branch,
            stock_rows=stock_rows,
            unit_cost=unit_cost,
            note=note,
            **validated,
        )
        return ok(
            {
                "item": ItemSerializer(result["item"], context=self._context(request)).data,
                "variants": ItemVariantSerializer(
                    result["variants"], many=True, context=self._context(request)
                ).data,
                "variants_created": result["variants_created"],
                "stock_movements": result["stock_movements"],
            },
            status.HTTP_201_CREATED,
        )


class VariantLookupView(_CatalogAPIView):
    """GET /catalog/variants/lookup?barcode=|sku= — the POS hot path."""

    method_permissions: ClassVar[dict[str, str]] = {"GET": "catalog.view"}
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation()}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        barcode = request.query_params.get("barcode", "").strip()
        sku = request.query_params.get("sku", "").strip()
        if not barcode and not sku:
            return error(400, "LOOKUP_PARAM_REQUIRED", "Provide a barcode or sku query parameter.")
        found = selectors.get_variant_for_lookup(tenant, _user(request), barcode=barcode, sku=sku)
        if found is None:
            return error(404, "VARIANT_NOT_FOUND", "No variant matches that code.")
        return ok(found)


class VariantForSaleView(_CatalogAPIView):
    """GET /catalog/variants/for-sale?branch_id=&search= — the sale dropdown.

    Gated on ``sale.create`` (not stock.view): a cashier builds bills but
    may not see stock reports. Returns only sellable rows (qty_on_hand > 0)
    with price bounds — never any cost figure (#10).
    """

    method_permissions: ClassVar[dict[str, str]] = {"GET": "sale.create"}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response_many=True, paginated=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        branch_id = _uuid_param(request, "branch_id")
        if branch_id is None:
            return error(400, "BRANCH_REQUIRED", "Provide a branch_id query parameter.")
        get_or_404(tenant, Branch, branch_id, "Branch")
        rows: Any = selectors.list_variants_for_sale(  # a plain list, not a QuerySet
            tenant,
            _user(request),
            branch_id=branch_id,
            search=request.query_params.get("search", "").strip(),
        )
        paginator = EnvelopePageNumberPagination()
        page = cast("list[Any]", paginator.paginate_queryset(rows, request, view=self))
        return paginator.get_paginated_response(page)
