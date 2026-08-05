"""Customer request shape plus field-level credit permission gating."""

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.customers.models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = (
            "id",
            "name",
            "phone",
            "pan",
            "address",
            "default_rate_type",
            "credit_limit",
            "opening_balance",
            "loyalty_points",
            "birthday_bs",
            "gender",
            "note",
            "is_active",
        )
        # is_active read-only: DRF coerces an omitted BooleanField to False
        # on multipart posts. Lifecycle goes through the delete endpoint.
        read_only_fields = ("id", "loyalty_points", "is_active")

    def validate_credit_limit(self, value: object) -> object:
        user = self.context.get("user")
        if not (user and user.has_perm("customer.credit")):
            raise PermissionDenied(
                detail="Changing a customer credit limit requires customer.credit.",
                code="CUSTOMER_CREDIT_PERMISSION_REQUIRED",
            )
        return value
