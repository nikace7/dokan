"""Shape validation and SimpleJWT refresh plumbing for platform auth."""

from typing import Any

from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

from apps.accounts.tokens import AUDIENCE_PLATFORM
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.tokens import PlatformRefreshToken


class PlatformLoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    otp = serializers.RegexField(r"^[0-9]{6}$", write_only=True)


class PlatformMeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlatformUser
        fields = ("id", "email", "full_name", "role")
        read_only_fields = fields


class PlatformTokenRefreshSerializer(TokenRefreshSerializer):
    token_class = PlatformRefreshToken

    def validate(self, attrs: dict[str, Any]) -> dict[str, str]:
        refresh = self.token_class(attrs["refresh"])
        if refresh.get("aud") != AUDIENCE_PLATFORM or refresh.get("token_use") != "refresh":
            raise PermissionDenied(detail="This token is not valid here.", code="REALM_MISMATCH")
        if not PlatformUser.objects.filter(pk=refresh.get("sub"), is_active=True).exists():
            raise AuthenticationFailed(
                "No active platform account was found.",
                code="no_active_account",
            )
        return super().validate(attrs)
