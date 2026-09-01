"""Shape validation and response schemas for tenant authentication."""

from typing import Any

from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

from apps.accounts.models import AuthSession
from apps.accounts.services.auth import touch_session
from apps.accounts.session_selectors import active_session_for_token
from apps.accounts.tokens import AUDIENCE_TENANT, TenantRefreshToken
from core.middleware.tenant import get_request_tenant


class TokenObtainSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32, trim_whitespace=True)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    device_id = serializers.UUIDField(required=False)
    device_name = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        default="Unknown device",
    )
    challenge_id = serializers.UUIDField(required=False)
    otp = serializers.RegexField(r"^\d{6}$", required=False)


class TokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    token_type = serializers.CharField()
    session_id = serializers.UUIDField()


class RefreshedTokensSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField(required=False)


class TenantTokenRefreshSerializer(TokenRefreshSerializer):
    """Rotate only a live tenant-bound registered-device session."""

    token_class = TenantRefreshToken

    def validate(self, attrs: dict[str, Any]) -> dict[str, str]:
        refresh = self.token_class(attrs["refresh"])
        if refresh.get("aud") != AUDIENCE_TENANT or refresh.get("token_use") != "refresh":
            raise PermissionDenied(detail="This token is not valid here.", code="REALM_MISMATCH")
        request = self.context.get("request")
        tenant = get_request_tenant(request) if request is not None else None
        if tenant is None:
            raise PermissionDenied(
                detail="Tenant API is only available on a shop subdomain.",
                code="TENANT_REQUIRED",
            )
        if refresh.get("tenant") != str(tenant.pk):
            raise PermissionDenied(
                detail="This token belongs to a different shop.",
                code="TOKEN_TENANT_MISMATCH",
            )
        session = active_session_for_token(
            tenant,
            session_id=refresh.get("sid"),
            user_id=refresh.get("user_id"),
        )
        if session is None:
            raise AuthenticationFailed(
                "This device session has ended.",
                code="SESSION_REVOKED",
            )
        touch_session(session)
        return super().validate(attrs)


class PasswordResetRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32, trim_whitespace=True)


class PasswordResetConfirmSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32, trim_whitespace=True)
    code = serializers.RegexField(r"^\d{6}$")
    new_password = serializers.CharField(
        min_length=10,
        max_length=128,
        write_only=True,
        trim_whitespace=False,
    )


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=128,
        write_only=True,
        trim_whitespace=False,
    )
    new_password = serializers.CharField(
        min_length=10,
        max_length=128,
        write_only=True,
        trim_whitespace=False,
    )


class RefreshTokenInputSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)


class OtpCodeSerializer(serializers.Serializer):
    code = serializers.RegexField(r"^\d{6}$")


class DisableLoginOtpSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=128,
        write_only=True,
        trim_whitespace=False,
    )


class AuthSessionSerializer(serializers.ModelSerializer):
    current = serializers.SerializerMethodField()

    class Meta:
        model = AuthSession
        fields = (
            "id",
            "device_id",
            "device_name",
            "ip",
            "last_seen_at",
            "created_at",
            "expires_at",
            "revoked_at",
            "current",
        )
        read_only_fields = fields

    def get_current(self, obj: AuthSession) -> bool:
        return str(obj.pk) == str(self.context.get("current_session_id"))


class AcceptedSerializer(serializers.Serializer):
    accepted = serializers.BooleanField()


class LoginOtpStatusSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
