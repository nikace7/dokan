"""DRF serializers for inventory — shape validation only; rules live in services.

``avg_cost`` / ``unit_cost`` follow the cost-visibility rule: dropped at the
field layer for users without ``pricing.view_cost`` (the selectors already
defer the columns, so the values never reach the serializer either).
"""

from typing import Any, cast

from rest_framework import serializers
from rest_framework.serializers import ListSerializer

from apps.inventory.models import (
    StockCount,
    StockCountItem,
    StockLevel,
    StockMovement,
    StockTransfer,
    StockTransferItem,
)


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
    image_url = serializers.SerializerMethodField()
    # Annotated by the levels selector (annotation attrs, not model fields).
    reorder_level = serializers.DecimalField(
        max_digits=12, decimal_places=3, read_only=True, allow_null=True
    )
    is_low = serializers.BooleanField(read_only=True)

    class Meta:
        model = StockLevel
        fields = (
            "id",
            "branch",
            "branch_code",
            "variant",
            "variant_sku",
            "item_name",
            "image_url",
            "qty_on_hand",
            "qty_reserved",
            "avg_cost",
            "reorder_level",
            "is_low",
            "updated_at",
        )
        read_only_fields = fields

    def get_image_url(self, obj: StockLevel) -> str | None:
        """Item photo as a public media URL; the levels selector already
        select_relateds variant__item, so this adds no queries."""
        image = obj.variant.item.image
        return image.url if image else None


class StockSummarySerializer(serializers.Serializer):
    """Tenant-wide current stock totals; valuation is cost-permission protected."""

    total_qty_on_hand = serializers.DecimalField(max_digits=24, decimal_places=3)
    total_qty_reserved = serializers.DecimalField(max_digits=24, decimal_places=3)
    total_qty_available = serializers.DecimalField(max_digits=24, decimal_places=3)
    stock_value = serializers.DecimalField(max_digits=30, decimal_places=2, required=False)

    def to_representation(self, instance: Any) -> dict[str, Any]:
        representation = super().to_representation(instance)
        user = self.context.get("user")
        if not user or not user.has_perm("pricing.view_cost"):
            representation.pop("stock_value", None)
        return representation


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


class TransferLineInputSerializer(serializers.Serializer):
    """One transfer line (create or receive)."""

    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)


class TransferCreateSerializer(serializers.Serializer):
    """POST /inventory/transfers payload."""

    from_branch = serializers.UUIDField()
    to_branch = serializers.UUIDField()
    note = serializers.CharField(required=False, allow_blank=True, default="")
    lines = TransferLineInputSerializer(many=True)


class TransferReceiveSerializer(serializers.Serializer):
    """POST /inventory/transfers/<id>/receive payload."""

    lines = TransferLineInputSerializer(many=True)


class StockTransferItemSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    item_name = serializers.CharField(source="variant.item.name", read_only=True)

    class Meta:
        model = StockTransferItem
        fields = (
            "id",
            "variant",
            "variant_sku",
            "item_name",
            "qty_sent",
            "qty_received",
            "unit_cost",
        )
        read_only_fields = fields


class StockTransferSerializer(CostAwareSerializer):
    """Drops line unit_cost for users without pricing.view_cost.

    The drop happens HERE, not in the child's __init__: declared nested
    fields are built at class-definition time without request context
    (same trap as the sales detail serializer).
    """

    from_branch_code = serializers.CharField(source="from_branch.code", read_only=True)
    to_branch_code = serializers.CharField(source="to_branch.code", read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, allow_null=True
    )
    items = StockTransferItemSerializer(many=True, read_only=True)

    class Meta:
        model = StockTransfer
        fields = (
            "id",
            "from_branch",
            "from_branch_code",
            "to_branch",
            "to_branch_code",
            "status",
            "sent_at",
            "received_at",
            "note",
            "created_by",
            "created_by_name",
            "created_at",
            "items",
        )
        read_only_fields = fields

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        user = self.context.get("user")
        if not (user and user.has_perm("pricing.view_cost")):
            items_field = cast("ListSerializer", self.fields["items"])
            cast("StockTransferItemSerializer", items_field.child).fields.pop("unit_cost", None)


class CountCreateSerializer(serializers.Serializer):
    """POST /inventory/counts payload."""

    branch = serializers.UUIDField()


class CountRecordLineSerializer(serializers.Serializer):
    """One counted line."""

    variant = serializers.UUIDField()
    counted_qty = serializers.DecimalField(max_digits=12, decimal_places=3)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class CountRecordSerializer(serializers.Serializer):
    """POST /inventory/counts/<id>/record payload."""

    counts = CountRecordLineSerializer(many=True)


class StockCountItemSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    item_name = serializers.CharField(source="variant.item.name", read_only=True)

    class Meta:
        model = StockCountItem
        fields = (
            "id",
            "variant",
            "variant_sku",
            "item_name",
            "system_qty",
            "counted_qty",
            "variance",
            "note",
        )
        read_only_fields = fields


class StockCountSerializer(serializers.ModelSerializer):
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, allow_null=True
    )
    items = StockCountItemSerializer(many=True, read_only=True)

    class Meta:
        model = StockCount
        fields = (
            "id",
            "branch",
            "branch_code",
            "status",
            "started_at",
            "finalized_at",
            "created_by",
            "created_by_name",
            "items",
        )
        read_only_fields = fields
