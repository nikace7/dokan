"""JWT authentication for platform users on the admin host."""

from typing import Any, cast

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.request import Request
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.accounts.tokens import AUDIENCE_PLATFORM
from apps.platformadmin.models import PlatformUser


class PlatformJWTAuthentication(BaseAuthentication):
    """Accept platform-audience access tokens and resolve PlatformUser only."""

    def __init__(self) -> None:
        self.jwt = JWTAuthentication()

    def authenticate(self, request: Request) -> tuple[Any, Any] | None:
        header = cast("bytes | None", self.jwt.get_header(request))
        if header is None:
            return None
        raw_token = self.jwt.get_raw_token(header)
        if raw_token is None:
            return None
        token = self.jwt.get_validated_token(raw_token)
        if token.get("aud") != AUDIENCE_PLATFORM or token.get("token_use") != "access":
            raise PermissionDenied(detail="This token is not valid here.", code="REALM_MISMATCH")
        user = PlatformUser.objects.filter(pk=token.get("sub"), is_active=True).first()
        if user is None:
            raise AuthenticationFailed(
                "No active platform account was found.",
                code="NO_ACTIVE_ACCOUNT",
            )
        return user, token

    def authenticate_header(self, request: Request) -> str:
        return self.jwt.authenticate_header(request)
