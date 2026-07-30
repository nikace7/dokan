"""DRF serializers for customers — shape validation only."""

from rest_framework import serializers

from apps.customers.models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = (
            "id",
            "name",
            "phone",
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
