"""DRF serializers for audit — read-only shape."""

from typing import Any

from rest_framework import serializers

from apps.audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True, allow_null=True)

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "actor",
            "actor_name",
            "action",
            "target_type",
            "target_id",
            "before",
            "after",
            "impersonated_by",
            "ip",
            "created_at",
        )
        read_only_fields = fields
