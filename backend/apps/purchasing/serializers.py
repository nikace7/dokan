"""DRF serializers for purchasing — shape validation only."""

from rest_framework import serializers

from apps.purchasing.models import Supplier


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
