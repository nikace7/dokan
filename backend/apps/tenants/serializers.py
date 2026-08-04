"""DRF serializers for tenants — shape validation only; rules live in services."""

from rest_framework import serializers

from apps.tenants.models import Branch, Tenant


class TenantSettingsSerializer(serializers.ModelSerializer):
    """Editable shop profile and presentation preferences."""

    plan_code = serializers.CharField(source="plan.code", read_only=True)

    class Meta:
        model = Tenant
        fields = (
            "id",
            "slug",
            "name",
            "name_np",
            "legal_name",
            "pan_vat_no",
            "vat_registered",
            "timezone",
            "calendar_pref",
            "locale",
            "status",
            "plan_code",
        )
        read_only_fields = ("id", "slug", "timezone", "status", "plan_code")


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
