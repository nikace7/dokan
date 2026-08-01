"""DRF serializers for expenses — shape validation only."""

from rest_framework import serializers

from apps.expenses.models import Expense, ExpenseCategory


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ("id", "name", "name_np", "is_active")
        # is_active read-only: DRF coerces an omitted BooleanField to False
        # on multipart posts. Lifecycle goes through the delete endpoint.
        read_only_fields = ("id", "is_active")


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    branch_code = serializers.CharField(source="branch.code", read_only=True, allow_null=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, allow_null=True
    )

    class Meta:
        model = Expense
        fields = (
            "id",
            "branch",
            "branch_code",
            "category",
            "category_name",
            "amount",
            "payee",
            "note",
            "business_date_ad",
            "business_date_bs",
            "fiscal_year_bs",
            "created_by",
            "created_by_name",
            "created_at",
        )
        read_only_fields = ("id", "business_date_bs", "fiscal_year_bs", "created_by", "created_at")


class ExpenseCreateSerializer(serializers.Serializer):
    """POST /expenses payload."""

    branch = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    business_date_ad = serializers.DateField()
    payee = serializers.CharField(required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ExpenseUpdateSerializer(serializers.Serializer):
    """PATCH /expenses/<id> payload (partial)."""

    branch = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.UUIDField(required=False)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    business_date_ad = serializers.DateField(required=False)
    payee = serializers.CharField(required=False, allow_blank=True)
    note = serializers.CharField(required=False, allow_blank=True)
