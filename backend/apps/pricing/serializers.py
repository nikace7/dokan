"""DRF serializers for pricing — shape validation only; rules live in services."""

from typing import Any

from rest_framework import serializers

from apps.pricing.models import ItemPrice, PriceChangeLog, RateType


class RateTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RateType
        fields = (
            "id",
            "code",
            "name",
            "name_np",
            "is_default",
            "sort_order",
            "default_margin_pct",
            "required_permission",
            "is_active",
        )
        # is_active is read-only: DRF coerces an omitted BooleanField to
        # False on form/multipart posts, which would silently create
        # inactive rows. Lifecycle goes through the deactivate endpoint.
        read_only_fields = ("id", "is_active")


class ItemPriceSerializer(serializers.ModelSerializer):
    rate_type_code = serializers.CharField(source="rate_type.code", read_only=True)

    class Meta:
        model = ItemPrice
        fields = (
            "id",
            "rate_type",
            "rate_type_code",
            "scope",
            "variant",
            "item",
            "category",
            "price",
            "effective_from",
            "effective_to",
            "created_by",
            "created_at",
        )
        read_only_fields = ("id", "created_by", "created_at")


class SetPriceSerializer(serializers.Serializer):
    """POST /pricing/prices payload — one price at one scope."""

    rate_type = serializers.UUIDField()
    scope = serializers.ChoiceField(choices=["VARIANT", "ITEM", "CATEGORY"])
    variant = serializers.UUIDField(required=False, allow_null=True)
    item = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.UUIDField(required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=14, decimal_places=2)
    effective_from = serializers.DateField()
    effective_to = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class PriceChangeLogSerializer(serializers.ModelSerializer):
    rate_type_code = serializers.CharField(source="rate_type.code", read_only=True, allow_null=True)
    changed_by_name = serializers.CharField(
        source="changed_by.full_name", read_only=True, allow_null=True
    )

    class Meta:
        model = PriceChangeLog
        fields = (
            "id",
            "target_type",
            "target_id",
            "rate_type",
            "rate_type_code",
            "old_price",
            "new_price",
            "changed_by",
            "changed_by_name",
            "reason",
            "created_at",
        )
        read_only_fields = fields


class BoundsSerializer(serializers.Serializer):
    """PATCH /pricing/bounds payload — at least one bound required."""

    min_selling_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    max_selling_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if "min_selling_price" not in attrs and "max_selling_price" not in attrs:
            raise serializers.ValidationError("Provide min_selling_price and/or max_selling_price.")
        return attrs
