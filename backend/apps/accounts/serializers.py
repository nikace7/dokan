"""DRF serializers for accounts — shape validation only; rules live in services."""

from typing import Any

from rest_framework import serializers


class TokenObtainSerializer(serializers.Serializer):
    """Login payload: phone + password, scoped to the request's tenant."""

    phone = serializers.CharField(max_length=32, trim_whitespace=True)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


class MeSerializer(serializers.Serializer):
    """Current user + resolved permissions for GET /auth/me."""

    id = serializers.UUIDField()
    phone = serializers.CharField()
    full_name = serializers.CharField()
    email = serializers.CharField(allow_null=True)
    must_change_password = serializers.BooleanField()
    permissions = serializers.ListField(child=serializers.CharField())

    @classmethod
    def for_user(cls, user: Any, permissions: frozenset[str]) -> dict[str, Any]:
        """Build the payload for a user (keeps the view thin)."""
        return cls(
            {
                "id": user.pk,
                "phone": user.phone,
                "full_name": user.full_name,
                "email": user.email,
                "must_change_password": user.must_change_password,
                "permissions": sorted(permissions),
            }
        ).data
