"""Serializers for the public storefront — explicit fields, never ModelSerializer

shortcuts on catalog models: accidentally exposing ``avg_cost`` or reorder
levels here would leak shop secrets to anonymous traffic (invariant 10).
"""

from rest_framework import serializers

from apps.catalog.models import Item


class PublicProductSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    name_np = serializers.CharField(allow_null=True)
    image = serializers.SerializerMethodField()
    category = serializers.CharField(source="category.name", default=None, allow_null=True)
    brand = serializers.CharField(source="brand.name", default=None, allow_null=True)
    price_min = serializers.DecimalField(
        source="min_selling_price", max_digits=14, decimal_places=2, allow_null=True
    )
    price_max = serializers.DecimalField(
        source="max_selling_price", max_digits=14, decimal_places=2, allow_null=True
    )
    in_stock = serializers.BooleanField()

    def get_image(self, obj: Item) -> str | None:
        """Same-origin media path — the shopfront host proxies /media/ like POS hosts."""
        return obj.image.url if obj.image else None
