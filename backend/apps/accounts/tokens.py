"""Token issuance per ADR 0001 (docs/DECISIONS/0001-jwt-claim-shape.md).

Tenant access/refresh tokens carry: ``sub`` (user uuid), ``tenant`` (tenant
uuid), ``aud`` = ``tenant``, ``token_use``, plus SimpleJWT's own ``user_id``
(needed by its authentication), ``jti`` and ``token_type``. Platform tokens
(``aud`` = ``platform``) are issued by the admin portal, which is not built
yet — the constant lives here so both realms share one vocabulary.
"""

from typing import TYPE_CHECKING, Any, Final, cast

from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

if TYPE_CHECKING:
    from apps.accounts.models import User

AUDIENCE_TENANT: Final = "tenant"
AUDIENCE_PLATFORM: Final = "platform"


class TenantRefreshToken(RefreshToken):
    """Refresh token for tenant users; access tokens derive from it."""

    @classmethod
    def for_user(cls, user: Any) -> "TenantRefreshToken":
        """Build a refresh token carrying the ADR 0001 tenant claims."""
        token = cast("TenantRefreshToken", super().for_user(user))
        token["sub"] = str(user.pk)
        token["aud"] = AUDIENCE_TENANT
        token["tenant"] = str(user.tenant_id)
        token["token_use"] = "refresh"
        return token

    @property
    def access_token(self) -> AccessToken:
        """Access token with token_use corrected after claim copy."""
        access = super().access_token
        access["token_use"] = "access"
        return access


def issue_tokens_for_user(user: "User") -> dict[str, str]:
    """Issue the access+refresh pair returned by the login endpoint."""
    refresh = TenantRefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "token_type": "Bearer",
    }
