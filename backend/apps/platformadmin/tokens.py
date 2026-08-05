"""JWT issuance for the platform realm, separate from tenant tokens."""

from typing import TYPE_CHECKING

from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.accounts.tokens import AUDIENCE_PLATFORM

if TYPE_CHECKING:
    from apps.platformadmin.models import PlatformUser


class PlatformRefreshToken(RefreshToken):
    """Rotating refresh token carrying only platform-realm identity."""

    @classmethod
    def for_platform_user(cls, user: "PlatformUser") -> "PlatformRefreshToken":
        token = cls()
        token["sub"] = str(user.pk)
        token["aud"] = AUDIENCE_PLATFORM
        token["token_use"] = "refresh"
        token.outstand()
        return token

    @property
    def access_token(self) -> AccessToken:
        access = super().access_token
        access["token_use"] = "access"
        return access


def issue_platform_tokens(user: "PlatformUser") -> dict[str, str]:
    refresh = PlatformRefreshToken.for_platform_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "token_type": "Bearer",
    }
