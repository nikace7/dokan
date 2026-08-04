"""DRF SMS request and read-only log shapes."""

from rest_framework import serializers

from apps.notifications.models import SmsLog


class ReceiptSmsSerializer(serializers.Serializer):
    invoice = serializers.UUIDField()
    to_phone = serializers.CharField(required=False, allow_blank=False, max_length=32)


class SmsLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmsLog
        fields = (
            "id",
            "to_phone",
            "template",
            "body",
            "provider",
            "provider_message_id",
            "status",
            "cost",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields
