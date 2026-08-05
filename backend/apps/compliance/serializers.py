"""DRF serializers for compliance — read-only shapes."""

from rest_framework import serializers

from apps.compliance.models import CbmsSyncLog


class CbmsSyncStatusSerializer(serializers.ModelSerializer):
    """Per-bill sync status for the billing UI."""

    class Meta:
        model = CbmsSyncLog
        fields = ("invoice", "status", "attempts", "last_error", "synced_at", "updated_at")
        read_only_fields = fields


class CbmsSyncFailureSerializer(serializers.ModelSerializer):
    """Failed sync row for the admin retry dashboard (payload included so
    ops can see exactly what would be sent)."""

    invoice_no = serializers.IntegerField(source="invoice.invoice_no", read_only=True)
    doc_type = serializers.CharField(source="invoice.doc_type", read_only=True)
    branch_code = serializers.CharField(source="invoice.branch.code", read_only=True)
    business_date_bs = serializers.CharField(source="invoice.business_date_bs", read_only=True)

    class Meta:
        model = CbmsSyncLog
        fields = (
            "id",
            "invoice",
            "invoice_no",
            "doc_type",
            "branch_code",
            "business_date_bs",
            "status",
            "attempts",
            "last_error",
            "payload",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields
