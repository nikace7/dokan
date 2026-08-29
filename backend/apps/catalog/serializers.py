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
    image_url = serializers.SerializerMethodField()
    variants_count = serializers.SerializerMethodField()
    mrp_min = serializers.SerializerMethodField()
    mrp_max = serializers.SerializerMethodField()
    website_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True, min_value=0
    )
    website_discount_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True, min_value=0
    )

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
            "image_url",
            "variants_count",
            "mrp_min",
            "mrp_max",
            "images",
            "attributes",
            "min_selling_price",
            "max_selling_price",
            "website_price",
            "website_discount_pct",
            "website_visible",
            "website_featured",
            "reorder_level",
            "is_active",
        )
        read_only_fields = ("id", "image_url", "variants_count", "mrp_min", "mrp_max", "is_active")

    def get_image_url(self, obj: Item) -> str | None:
        """Public media URL (MEDIA_URL + storage key), never a filesystem path."""
        return obj.image.url if obj.image else None

    def get_variants_count(self, obj: Item) -> int | None:
        """Active-variant count — annotated by list_items; null on detail writes."""
        return getattr(obj, "variants_count", None)

    def get_mrp_min(self, obj: Item) -> str | None:
        value = getattr(obj, "mrp_min", None)
        return str(value) if value is not None else None

    def get_mrp_max(self, obj: Item) -> str | None:
        value = getattr(obj, "mrp_max", None)
        return str(value) if value is not None else None


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


class QuickCreateStockSerializer(serializers.Serializer):
    """Optional opening-stock block of the quick-create payload.

    ``quantities`` maps ``"<size>::<colour>"`` to a quantity string; pair
    membership and qty > 0 are business rules checked in the service.
    """

    branch = serializers.UUIDField()
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=2)
    note = serializers.CharField(required=False, allow_blank=True, default="")
    quantities = serializers.DictField(
        child=serializers.DecimalField(max_digits=12, decimal_places=3),
        allow_empty=False,
    )


class QuickCreateProductSerializer(serializers.Serializer):
    """One-shot product payload: item fields + matrix (+ optional stock).

    The item field set mirrors ItemSerializer's writable fields exactly so
    every item attribute stays settable through the simplified flow.
    """

    code = serializers.CharField()
    name = serializers.CharField()
    name_np = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    category = serializers.UUIDField(required=False, allow_null=True)
    brand = serializers.UUIDField(required=False, allow_null=True)
    size_chart = serializers.UUIDField(required=False, allow_null=True)
    gender = serializers.ChoiceField(choices=Item.Gender.choices, required=False, allow_null=True)
    season = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    collection_tag = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    hsn_code = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    unit = serializers.CharField(required=False, default="PCS")
    is_vat_applicable = serializers.BooleanField(required=False, default=False)
    images = serializers.JSONField(required=False, allow_null=True)
    attributes = serializers.JSONField(required=False, allow_null=True)
    min_selling_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    max_selling_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    website_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True, min_value=0
    )
    website_discount_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True, min_value=0
    )
    website_visible = serializers.BooleanField(required=False, default=True)
    website_featured = serializers.BooleanField(required=False, default=False)
    reorder_level = serializers.DecimalField(
        max_digits=12, decimal_places=3, required=False, allow_null=True
    )

    sizes = serializers.ListField(child=serializers.CharField(max_length=32), allow_empty=False)
    colors = serializers.ListField(child=serializers.CharField(max_length=64), allow_empty=False)
    mrp = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    stock = QuickCreateStockSerializer(required=False)
