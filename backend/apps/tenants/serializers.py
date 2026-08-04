"""DRF serializers for tenants — shape validation only; rules live in services."""

from rest_framework import serializers

from apps.tenants.models import Branch


class BranchSerializer(serializers.ModelSerializer):
    """Branch metadata used by operational screens and branch selectors."""

    class Meta:
        model = Branch
        fields = (
            "id",
            "code",
            "name",
            "name_np",
            "address",
            "phone",
            "invoice_prefix",
            "is_default",
            "is_active",
        )
        read_only_fields = fields
