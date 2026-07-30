"""DRF serializers for catalog — shape validation only; rules live in services.

``avg_cost`` is dropped at the serializer field layer for users without
``pricing.view_cost`` (design §4.6 — one of the three enforcement points;
the selector and the UI are the other two).
"""

from typing import Any

from rest_framework import serializers

from apps.catalog.models import Brand, Category, Item, ItemVariant, SizeChart


class TenantContextSerializer(serializers.ModelSerializer):
    """Base: drops cost fields for users without pricing.view_cost."""

    class Meta:
        model: Any = None
        fields: Any = ()

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        user = self.context.get("user")
        if "avg_cost" in self.fields and not (user and user.has_perm("pricing.view_cost")):
            self.fields.pop("avg_cost")


class CategorySerializer(TenantContextSerializer):
    class Meta:
        model = Category
        fields = (
            "id",
            "parent",
            "name",
            "name_np",
            "size_chart",
            "default_margin_pct",
            "min_price_pct",
            "max_price_pct",
            "sort_order",
            "is_active",
        )
        read_only_fields = ("id", "is_active")


class BrandSerializer(TenantContextSerializer):
    class Meta:
        model = Brand
        fields = ("id", "name", "is_active")
        read_only_fields = ("id", "is_active")


class SizeChartSerializer(TenantContextSerializer):
    values = serializers.ListField(child=serializers.CharField(max_length=32), allow_empty=False)

    class Meta:
        model = SizeChart
        fields = ("id", "name", "values", "is_active")
        read_only_fields = ("id", "is_active")


class ItemSerializer(TenantContextSerializer):
    class Meta:
        model = Item
        fields = (
            "id",
            "code",
            "name",
            "name_np",
            "category",
            "brand",
            "size_chart",
            "gender",
            "season",
            "collection_tag",
            "hsn_code",
            "unit",
            "is_vat_applicable",
            "images",
            "attributes",
            "min_selling_price",
            "max_selling_price",
            "reorder_level",
            "is_active",
        )
        read_only_fields = ("id", "is_active")


class ItemVariantSerializer(TenantContextSerializer):
    class Meta:
        model = ItemVariant
        fields = (
            "id",
            "item",
            "size",
            "color",
            "color_hex",
            "sku",
            "barcode",
            "mrp",
            "min_selling_price",
            "max_selling_price",
            "avg_cost",
            "is_active",
        )
        read_only_fields = ("id", "avg_cost", "item", "is_active")  # avg_cost: inventory writes it


class VariantBulkSerializer(serializers.Serializer):
    """Size × colour matrix entry payload."""

    sizes = serializers.ListField(child=serializers.CharField(max_length=32), allow_empty=False)
    colors = serializers.ListField(child=serializers.CharField(max_length=64), allow_empty=False)
    mrp = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
