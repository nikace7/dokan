"""Thin tenant-auth HTTP views: login, recovery, OTP, and device sessions."""

from typing import Any, ClassVar, cast
from uuid import UUID

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts import selectors
from apps.accounts.auth_serializers import (
    AcceptedSerializer,
    AuthSessionSerializer,
    DisableLoginOtpSerializer,
    LoginOtpStatusSerializer,
    OtpCodeSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RefreshedTokensSerializer,
    RefreshTokenInputSerializer,
    TenantTokenRefreshSerializer,
    TokenObtainSerializer,
    TokenPairSerializer,
)
from apps.accounts.models import AccountOtp, User
from apps.accounts.serializers import MeSerializer
from apps.accounts.services.auth import (
    AuthError,
    authenticate_tenant_user,
    complete_login,
    revoke_other_sessions,
    revoke_session,
)
from apps.accounts.services.recovery import (
    change_password,
    disable_login_otp,
    enable_login_otp,
    issue_account_otp,
    request_password_reset,
    reset_password,
    verify_account_otp,
)
from apps.accounts.session_selectors import list_user_sessions
from apps.accounts.tokens import TenantRefreshToken, issue_tokens_for_user
from apps.tenants.selectors import get_effective_plan_features
from core.middleware.tenant import get_request_tenant, require_request_tenant
from core.openapi import operation
from core.responses import ServiceError, error, ok
from core.throttles import TenantAuthThrottle


def _user(request: Request) -> User:
    return cast("User", request.user)


def _session_id(request: Request) -> Any:
    auth = request.auth
    getter = getattr(auth, "get", None)
    return getter("sid") if callable(getter) else None


class AuthServiceView(APIView):
    """Translate service failures into the shared API envelope."""

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)


class TokenObtainView(AuthServiceView):
    permission_classes = (AllowAny,)
    authentication_classes: tuple = ()
    throttle_classes = (TenantAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=TokenObtainSerializer, response=TokenPairSerializer),
    }

    def post(self, request: Request) -> Response:
        tenant = get_request_tenant(request)
        if tenant is None:
            return error(400, "TENANT_REQUIRED", "Log in from your shop's subdomain.")
        serializer = TokenObtainSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            user = authenticate_tenant_user(
                tenant,
                phone=data["phone"],
                password=data["password"],
                request=request,
            )
        except AuthError as exc:
            http_status = 423 if exc.code == "ACCOUNT_LOCKED" else 401
            return error(http_status, exc.code, exc.message)

        if user.login_otp_required:
            if data.get("challenge_id") and data.get("otp"):
                verify_account_otp(
                    tenant,
                    user=user,
                    purpose=AccountOtp.Purpose.LOGIN,
                    challenge_id=data["challenge_id"],
                    code=data["otp"],
                )
            else:
                challenge = issue_account_otp(
                    tenant,
                    user=user,
                    purpose=AccountOtp.Purpose.LOGIN,
                )
                return error(
                    428,
                    "OTP_REQUIRED",
                    "Enter the six-digit code sent to your phone.",
                    details={"challenge_id": str(challenge.pk)},
                )

        session = complete_login(
            tenant,
            user=user,
            device_id=data.get("device_id"),
            device_name=data.get("device_name", "Unknown device"),
            request=request,
        )
        return ok(issue_tokens_for_user(user, session))


class TenantTokenRefreshView(TokenRefreshView):
    serializer_class = TenantTokenRefreshSerializer
    throttle_classes = (TenantAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=RefreshTokenInputSerializer,
            response=RefreshedTokensSerializer,
        ),
    }

    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            response.data = {"data": response.data, "error": None}
        return response


class MeView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=MeSerializer),
    }

    def get(self, request: Request) -> Response:
        user = _user(request)
        tenant = require_request_tenant(request)
        return ok(
            MeSerializer.for_user(
                user,
                selectors.get_permission_codes(user),
                {
                    "code": tenant.plan.code,
                    "name": tenant.plan.name,
                    "features": get_effective_plan_features(tenant),
                },
                is_owner=selectors.is_owner(user),
                shop_name=tenant.name,
                shop_name_np=tenant.name_np,
                currency=tenant.currency,
            )
        )


class LogoutView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=RefreshTokenInputSerializer, response=AcceptedSerializer),
    }

    def post(self, request: Request) -> Response:
        serializer = RefreshTokenInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = require_request_tenant(request)
        user = _user(request)
        session_id = _session_id(request)
        revoke_session(
            tenant,
            actor=user,
            session_id=session_id,
            request=request,
            action="auth.logout",
        )
        try:
            refresh = TenantRefreshToken(serializer.validated_data["refresh"])
            if (
                refresh.get("sid") == str(session_id)
                and refresh.get("tenant") == str(tenant.pk)
                and refresh.get("user_id") == str(user.pk)
            ):
                refresh.blacklist()
        except TokenError:
            pass
        return ok({"accepted": True})


class SessionListView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=AuthSessionSerializer, response_many=True),
    }

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        rows = list_user_sessions(tenant, _user(request))
        return ok(
            AuthSessionSerializer(
                rows,
                many=True,
                context={"current_session_id": _session_id(request)},
            ).data
        )


class SessionRevokeView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(response=AuthSessionSerializer),
    }

    def post(self, request: Request, pk: UUID) -> Response:
        tenant = require_request_tenant(request)
        session = revoke_session(
            tenant,
            actor=_user(request),
            session_id=pk,
            request=request,
        )
        return ok(
            AuthSessionSerializer(
                session,
                context={"current_session_id": _session_id(request)},
            ).data
        )


class SessionRevokeOthersView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        count = revoke_other_sessions(
            tenant,
            actor=_user(request),
            current_session_id=_session_id(request),
            request=request,
        )
        return ok({"revoked_count": count})


class PasswordResetRequestView(AuthServiceView):
    permission_classes = (AllowAny,)
    authentication_classes: tuple = ()
    throttle_classes = (TenantAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=PasswordResetRequestSerializer,
            response=AcceptedSerializer,
            status_code=202,
        )
    }

    def post(self, request: Request) -> Response:
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = require_request_tenant(request)
        request_password_reset(tenant, phone=serializer.validated_data["phone"])
        return ok({"accepted": True}, status.HTTP_202_ACCEPTED)


class PasswordResetConfirmView(AuthServiceView):
    permission_classes = (AllowAny,)
    authentication_classes: tuple = ()
    throttle_classes = (TenantAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(
            request=PasswordResetConfirmSerializer,
            response=AcceptedSerializer,
        )
    }

    def post(self, request: Request) -> Response:
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = require_request_tenant(request)
        reset_password(tenant, request=request, **serializer.validated_data)
        return ok({"accepted": True})


class PasswordChangeView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=PasswordChangeSerializer, response=AcceptedSerializer),
    }

    def post(self, request: Request) -> Response:
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = require_request_tenant(request)
        change_password(
            tenant,
            actor=_user(request),
            current_session_id=_session_id(request),
            request=request,
            **serializer.validated_data,
        )
        return ok({"accepted": True})


class LoginOtpRequestView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(response=AcceptedSerializer, status_code=202),
    }

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        issue_account_otp(
            tenant,
            user=_user(request),
            purpose=AccountOtp.Purpose.LOGIN_ENABLE,
        )
        return ok({"accepted": True}, status.HTTP_202_ACCEPTED)


class LoginOtpView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=LoginOtpStatusSerializer),
        "DELETE": operation(
            request=DisableLoginOtpSerializer,
            response=LoginOtpStatusSerializer,
        ),
    }

    def get(self, request: Request) -> Response:
        return ok({"enabled": _user(request).login_otp_required})

    def delete(self, request: Request) -> Response:
        serializer = DisableLoginOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = require_request_tenant(request)
        disable_login_otp(
            tenant,
            actor=_user(request),
            current_password=serializer.validated_data["current_password"],
            request=request,
        )
        return ok({"enabled": False})


class LoginOtpConfirmView(AuthServiceView):
    permission_classes = (IsAuthenticated,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=OtpCodeSerializer, response=LoginOtpStatusSerializer),
    }

    def post(self, request: Request) -> Response:
        serializer = OtpCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = require_request_tenant(request)
        enable_login_otp(
            tenant,
            actor=_user(request),
            code=serializer.validated_data["code"],
            request=request,
        )
        return ok({"enabled": True})
