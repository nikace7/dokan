"""DRF serializers for sales — shape validation only; rules live in services."""

from decimal import Decimal
from typing import Any, cast

from rest_framework import serializers
from rest_framework.serializers import ListSerializer

from apps.sales.models import SalesInvoice, SalesInvoiceItem
from apps.sales.services import PAYMENT_METHODS


class SaleLineSerializer(serializers.Serializer):
    """One incoming bill line."""

    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)
    unit_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    discount = serializers.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))


class PaymentSerializer(serializers.Serializer):
    """One tender. CREDIT = udharo (not part of paid_amount)."""

    method = serializers.ChoiceField(choices=sorted(PAYMENT_METHODS))
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)


class SaleCreateSerializer(serializers.Serializer):
    """POST /sales payload."""

    branch = serializers.UUIDField()
    rate_type = serializers.UUIDField()
    customer = serializers.UUIDField(required=False, allow_null=True)
    lines = SaleLineSerializer(many=True)
    payments = PaymentSerializer(many=True, required=False, default=list)
    is_vat_bill = serializers.BooleanField(required=False, default=False)
    bill_discount = serializers.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    round_off = serializers.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    device_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    override_reason = serializers.CharField(required=False, allow_blank=True, default="")


class HoldBillSerializer(SaleCreateSerializer):
    """POST /sales/hold payload — same as a sale, minus payments."""

    payments = None  # type: ignore[assignment]  # held bills take no tender


class CompleteBillSerializer(serializers.Serializer):
    """POST /sales/<id>/complete payload."""

    payments = PaymentSerializer(many=True, required=False, default=list)
    override_reason = serializers.CharField(required=False, allow_blank=True, default="")


class SalesInvoiceItemSerializer(serializers.ModelSerializer):
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    item_name = serializers.CharField(source="variant.item.name", read_only=True)
    item_name_np = serializers.CharField(
        source="variant.item.name_np", read_only=True, allow_null=True
    )

    class Meta:
        model = SalesInvoiceItem
        fields = (
            "id",
            "variant",
            "variant_sku",
            "item_name",
            "item_name_np",
            "qty",
            "rate_type",
            "unit_price",
            "discount",
            "line_total",
            "cost_at_sale",
            "returned_qty",
        )
        read_only_fields = fields


class SalesInvoiceSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    tenant_name_np = serializers.CharField(source="tenant.name_np", read_only=True, allow_null=True)
    legal_name = serializers.CharField(source="tenant.legal_name", read_only=True, allow_null=True)
    pan_vat_no = serializers.CharField(source="tenant.pan_vat_no", read_only=True, allow_null=True)
    vat_registered = serializers.BooleanField(source="tenant.vat_registered", read_only=True)
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    invoice_prefix = serializers.CharField(source="branch.invoice_prefix", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    branch_name_np = serializers.CharField(source="branch.name_np", read_only=True, allow_null=True)
    branch_address = serializers.CharField(source="branch.address", read_only=True, allow_null=True)
    branch_phone = serializers.CharField(source="branch.phone", read_only=True, allow_null=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True, allow_null=True)
    customer_pan = serializers.CharField(source="customer.pan", read_only=True, allow_null=True)
    rate_type_code = serializers.CharField(source="rate_type.code", read_only=True)
    print_count = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, allow_null=True
    )

    class Meta:
        model = SalesInvoice
        fields = (
            "id",
            "tenant_name",
            "tenant_name_np",
            "legal_name",
            "pan_vat_no",
            "vat_registered",
            "branch",
            "branch_code",
            "invoice_prefix",
            "branch_name",
            "branch_name_np",
            "branch_address",
            "branch_phone",
            "invoice_no",
            "doc_type",
            "customer",
            "customer_pan",
            "customer_name",
            "rate_type",
            "rate_type_code",
            "subtotal",
            "discount_amount",
            "discount_reason",
            "taxable_amount",
            "vat_amount",
            "round_off",
            "total",
            "paid_amount",
            "due_amount",
            "status",
            "is_vat_bill",
            "print_count",
            "tenders",
            "datetime_ad",
            "business_date_ad",
            "business_date_bs",
            "fiscal_year_bs",
            "device_id",
            "idempotency_key",
            "created_by",
            "created_by_name",
            "created_at",
        )
        read_only_fields = fields

    def get_print_count(self, obj: SalesInvoice) -> int:
        return int(getattr(obj, "receipt_print_count", obj.print_count))


class SalesInvoiceDetailSerializer(SalesInvoiceSerializer):
    items = SalesInvoiceItemSerializer(many=True, read_only=True)

    class Meta(SalesInvoiceSerializer.Meta):
        fields = (*SalesInvoiceSerializer.Meta.fields, "items")  # type: ignore[assignment]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # Cost drop MUST happen here, not in the child's __init__: declared
        # nested fields are instantiated at class-definition time without
        # request context (DRF binds context later), so the child never saw
        # the user and always popped cost_at_sale.
        user = self.context.get("user")
        if not (user and user.has_perm("pricing.view_cost")):
            items_field = cast("ListSerializer", self.fields["items"])
            cast("SalesInvoiceItemSerializer", items_field.child).fields.pop("cost_at_sale", None)


class ReturnLineSerializer(serializers.Serializer):
    """One returned line: variant + qty (price/cost come from the original)."""

    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)


class RefundSerializer(serializers.Serializer):
    """One refund settlement entry for a return's refunds list."""

    method = serializers.ChoiceField(
        choices=["CASH", "ESEWA", "KHALTI", "FONEPAY", "QR", "CARD", "BANK", "CREDIT_NOTE"]
    )
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)


class ReturnCreateSerializer(serializers.Serializer):
    """POST /sales/returns payload."""

    original_invoice = serializers.UUIDField()
    lines = ReturnLineSerializer(many=True)
    reason = serializers.CharField(max_length=500, trim_whitespace=False)
    refunds = RefundSerializer(many=True, required=False, default=list)


class ExchangeCreateSerializer(serializers.Serializer):
    """POST /sales/exchanges payload."""

    original_invoice = serializers.UUIDField()
    returned_lines = ReturnLineSerializer(many=True)
    new_lines = SaleLineSerializer(many=True)
    payments = PaymentSerializer(many=True, required=False, default=list)
    reason = serializers.CharField(max_length=500, trim_whitespace=False)
    override_reason = serializers.CharField(required=False, allow_blank=True, default="")


class SharedBillItemSerializer(serializers.ModelSerializer):
    """One public receipt line — exactly what the printed receipt shows."""

    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    item_name = serializers.CharField(source="variant.item.name", read_only=True)
    item_name_np = serializers.CharField(
        source="variant.item.name_np", read_only=True, allow_null=True
    )

    class Meta:
        model = SalesInvoiceItem
        fields = (
            "id",
            "variant",
            "variant_sku",
            "item_name",
            "item_name_np",
            "qty",
            "unit_price",
            "discount",
            "line_total",
        )
        read_only_fields = fields


class SharedBillSerializer(serializers.ModelSerializer):
    """Public receipt payload (GET /sales/shared/<token>).

    Exactly the shape the frontend ReceiptPanel renders — shop/branch/
    customer identity, totals, tenders, lines. NO cost columns (#10) and NO
    staff PII beyond what the receipt prints (no created_by / device_id /
    idempotency_key / customer PAN).
    """

    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    tenant_name_np = serializers.CharField(source="tenant.name_np", read_only=True, allow_null=True)
    legal_name = serializers.CharField(source="tenant.legal_name", read_only=True, allow_null=True)
    pan_vat_no = serializers.CharField(source="tenant.pan_vat_no", read_only=True, allow_null=True)
    vat_registered = serializers.BooleanField(source="tenant.vat_registered", read_only=True)
    invoice_prefix = serializers.CharField(source="branch.invoice_prefix", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    branch_name_np = serializers.CharField(source="branch.name_np", read_only=True, allow_null=True)
    branch_address = serializers.CharField(source="branch.address", read_only=True, allow_null=True)
    branch_phone = serializers.CharField(source="branch.phone", read_only=True, allow_null=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True, allow_null=True)
    print_count = serializers.SerializerMethodField()
    items = SharedBillItemSerializer(many=True, read_only=True)

    class Meta:
        model = SalesInvoice
        fields = (
            "id",
            "tenant_name",
            "tenant_name_np",
            "legal_name",
            "pan_vat_no",
            "vat_registered",
            "invoice_prefix",
            "branch_name",
            "branch_name_np",
            "branch_address",
            "branch_phone",
            "invoice_no",
            "doc_type",
            "customer_name",
            "subtotal",
            "discount_amount",
            "taxable_amount",
            "vat_amount",
            "round_off",
            "total",
            "paid_amount",
            "due_amount",
            "status",
            "is_vat_bill",
            "print_count",
            "tenders",
            "datetime_ad",
            "business_date_ad",
            "business_date_bs",
            "fiscal_year_bs",
            "created_at",
            "items",
        )
        read_only_fields = fields

    def get_print_count(self, obj: SalesInvoice) -> int:
        return int(getattr(obj, "receipt_print_count", obj.print_count))
