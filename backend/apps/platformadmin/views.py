"""Thin platform-admin authentication views."""

from typing import cast

from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from apps.platformadmin.authentication import PlatformJWTAuthentication
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.serializers import (
    PlatformLoginSerializer,
    PlatformMeSerializer,
    PlatformTokenRefreshSerializer,
)
from apps.platformadmin.services import PlatformAuthError, authenticate_platform_user
from apps.platformadmin.throttles import PlatformAuthThrottle
from apps.platformadmin.tokens import issue_platform_tokens
from core.responses import error, ok


class PlatformTokenObtainView(APIView):
    authentication_classes: tuple = ()
    permission_classes = (AllowAny,)
    throttle_classes = (PlatformAuthThrottle,)

    def post(self, request: Request) -> Response:
        serializer = PlatformLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = authenticate_platform_user(**serializer.validated_data)
        except PlatformAuthError as exc:
            return error(exc.http_status, exc.code, exc.message)
        return ok(issue_platform_tokens(user))


class PlatformTokenRefreshView(TokenRefreshView):
    serializer_class = PlatformTokenRefreshSerializer
    throttle_classes = (PlatformAuthThrottle,)

    def post(self, request: Request, *args: object, **kwargs: object) -> Response:
        response = super().post(request, *args, **kwargs)
        response.data = {"data": response.data, "error": None}
        return response


class PlatformMeView(APIView):
    authentication_classes = (PlatformJWTAuthentication,)
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        return ok(PlatformMeSerializer(cast("PlatformUser", request.user)).data)
