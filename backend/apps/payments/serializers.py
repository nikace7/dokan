"""DRF serializers for payments — shape validation only."""

from rest_framework import serializers

from apps.payments.models import CashSession, Payment, PaymentAllocation

_METHODS = ["CASH", "ESEWA", "KHALTI", "FONEPAY", "CARD", "BANK"]


class AllocationInputSerializer(serializers.Serializer):
    """One allocation of a receipt/payment against a specific invoice."""

    invoice = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)


class ReceiptCreateSerializer(serializers.Serializer):
    """POST /payments/receipts payload."""

    branch = serializers.UUIDField()
    customer = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    method = serializers.ChoiceField(choices=_METHODS)
    ref_no = serializers.CharField(required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")
    allocations = AllocationInputSerializer(many=True, required=False, default=list)


class SupplierPaymentCreateSerializer(serializers.Serializer):
    """POST /payments/supplier-payments payload."""

    branch = serializers.UUIDField()
    supplier = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    method = serializers.ChoiceField(choices=_METHODS)
    ref_no = serializers.CharField(required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")
    allocations = AllocationInputSerializer(many=True, required=False, default=list)


class PaymentAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentAllocation
        fields = ("id", "sales_invoice", "purchase_invoice", "amount")
        read_only_fields = fields


class PaymentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True, allow_null=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, allow_null=True)
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    allocations = PaymentAllocationSerializer(many=True, read_only=True)

    class Meta:
        model = Payment
        fields = (
            "id",
            "branch",
            "branch_code",
            "direction",
            "party_type",
            "customer",
            "customer_name",
            "supplier",
            "supplier_name",
            "method",
            "amount",
            "ref_no",
            "note",
            "business_date_ad",
            "business_date_bs",
            "fiscal_year_bs",
            "created_by",
            "created_at",
            "allocations",
        )
        read_only_fields = fields


class CashSessionOpenSerializer(serializers.Serializer):
    """POST /cash-sessions/open payload."""

    branch = serializers.UUIDField()
    opening_float = serializers.DecimalField(max_digits=14, decimal_places=2)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class CashSessionCloseSerializer(serializers.Serializer):
    """POST /cash-sessions/<id>/close payload."""

    counted_cash = serializers.DecimalField(max_digits=14, decimal_places=2)


class CashSessionSerializer(serializers.ModelSerializer):
    branch_code = serializers.CharField(source="branch.code", read_only=True)
    opened_by_name = serializers.CharField(
        source="opened_by.full_name", read_only=True, allow_null=True
    )

    class Meta:
        model = CashSession
        fields = (
            "id",
            "branch",
            "branch_code",
            "opened_by",
            "opened_by_name",
            "opened_at",
            "opening_float",
            "closed_by",
            "closed_at",
            "counted_cash",
            "expected_cash",
            "variance",
            "note",
        )
        read_only_fields = fields


class LedgerRowSerializer(serializers.Serializer):
    """One running-balance row in a party ledger response."""

    date = serializers.DateField()
    kind = serializers.CharField()
    ref = serializers.CharField()
    debit = serializers.DecimalField(max_digits=14, decimal_places=2)
    credit = serializers.DecimalField(max_digits=14, decimal_places=2)
    balance = serializers.DecimalField(max_digits=14, decimal_places=2)
