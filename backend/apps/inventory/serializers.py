"""DRF serializers for inventory — shape validation only; rules live in services.

``avg_cost`` / ``unit_cost`` follow the cost-visibility rule: dropped at the
field layer for users without ``pricing.view_cost`` (the selectors already
defer the columns, so the values never reach the serializer either).
"""

from typing import Any

from rest_framework import serializers

from apps.inventory.models import StockLevel, StockMovement


class CostAwareSerializer(serializers.ModelSerializer):
    """Drops cost fields for users without pricing.view_cost."""

    class Meta:
        model: Any = None
        fields: Any = ()

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        user = self.context.get("user")
        can_view_cost = bool(user and user.has_perm("pricing.view_cost"))
        if not can_view_cost:
            for cost_field in ("avg_cost", "unit_cost"):
                self.fields.pop(cost_field, None)


class StockLevelSerializer(CostAwareSerializer):
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    item_name = serializers.CharField(source="variant.item.name", read_only=True)

    class Meta:
        model = StockLevel
        fields = (
            "id",
            "branch",
            "branch_code",
            "variant",
            "variant_sku",
            "item_name",
            "qty_on_hand",
            "qty_reserved",
            "avg_cost",
            "updated_at",
        )
        read_only_fields = fields


class StockMovementSerializer(CostAwareSerializer):
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = StockMovement
        fields = (
            "id",
            "branch",
            "branch_code",
            "variant",
            "variant_sku",
            "type",
            "qty_delta",
            "unit_cost",
            "balance_after",
            "ref_type",
            "ref_id",
            "note",
            "business_date_ad",
            "business_date_bs",
            "fiscal_year_bs",
            "created_by",
            "created_by_name",
            "created_at",
        )
        read_only_fields = fields


class OpeningStockSerializer(serializers.Serializer):
    """POST /inventory/opening payload."""

    branch = serializers.UUIDField()
    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=2)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class AdjustmentSerializer(serializers.Serializer):
    """POST /inventory/adjustments payload."""

    branch = serializers.UUIDField()
    variant = serializers.UUIDField()
    qty_delta = serializers.DecimalField(max_digits=12, decimal_places=3)
    # trim_whitespace=False: a whitespace-only reason must reach the service
    # and fail there as REASON_REQUIRED, not as a shape error.
    reason = serializers.CharField(max_length=500, trim_whitespace=False)


class WriteOffSerializer(serializers.Serializer):
    """POST /inventory/write-offs payload."""

    branch = serializers.UUIDField()
    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)
    reason = serializers.CharField(max_length=500, trim_whitespace=False)
