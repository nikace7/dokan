"""DRF serializers for purchasing — shape validation only."""

from decimal import Decimal

from rest_framework import serializers

from apps.purchasing.models import PurchaseInvoice, PurchaseInvoiceItem, Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = (
            "id",
            "name",
            "phone",
            "pan_no",
            "address",
            "opening_balance",
            "credit_days",
            "is_active",
        )
        # is_active read-only: DRF coerces an omitted BooleanField to False
        # on multipart posts. Lifecycle goes through the delete endpoint.
        read_only_fields = ("id", "is_active")


class PurchaseItemInputSerializer(serializers.Serializer):
    """One incoming purchase line."""

    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=2)
    discount = serializers.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))


class PurchaseInvoiceCreateSerializer(serializers.Serializer):
    """POST /purchasing/invoices payload (creates a DRAFT)."""

    branch = serializers.UUIDField()
    supplier = serializers.UUIDField()
    bill_date_ad = serializers.DateField()
    is_vat_bill = serializers.BooleanField(required=False, default=False)
    other_charges = serializers.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    note = serializers.CharField(required=False, allow_blank=True, default="")
    lines = PurchaseItemInputSerializer(many=True)


class PurchaseInvoiceUpdateSerializer(serializers.Serializer):
    """PATCH /purchasing/invoices/<id> payload (DRAFT only)."""

    supplier = serializers.UUIDField(required=False)
    bill_date_ad = serializers.DateField(required=False)
    is_vat_bill = serializers.BooleanField(required=False)
    other_charges = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    note = serializers.CharField(required=False, allow_blank=True)
    lines = PurchaseItemInputSerializer(many=True, required=False)


class PurchaseInvoiceItemSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    item_name = serializers.CharField(source="variant.item.name", read_only=True)

    class Meta:
        model = PurchaseInvoiceItem
        fields = (
            "id",
            "variant",
            "variant_sku",
            "item_name",
            "qty",
            "unit_cost",
            "discount",
            "line_total",
        )
        read_only_fields = fields


class PurchaseInvoiceSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    items = PurchaseInvoiceItemSerializer(many=True, read_only=True)

    class Meta:
        model = PurchaseInvoice
        fields = (
            "id",
            "branch",
            "branch_code",
            "supplier",
            "supplier_name",
            "invoice_no",
            "supplier_bill_no",
            "bill_date_ad",
            "bill_date_bs",
            "fiscal_year_bs",
            "subtotal",
            "discount",
            "taxable_amount",
            "vat_amount",
            "other_charges",
            "total",
            "paid_amount",
            "due_amount",
            "status",
            "is_vat_bill",
            "note",
            "created_by",
            "created_at",
            "items",
        )
        read_only_fields = fields
