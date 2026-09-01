"""Thin authentication and control-plane views for the admin host."""

from typing import Any, ClassVar, cast
from uuid import UUID

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from apps.platformadmin import selectors, services, tenant_services
from apps.platformadmin.authentication import PlatformJWTAuthentication
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.permissions import ALL_PLATFORM_ROLES, PlatformRolePermission
from apps.platformadmin.provisioning import provision_tenant
from apps.platformadmin.serializers import (
    FeatureOverrideSerializer,
    FeatureOverrideSetSerializer,
    PlanCreateSerializer,
    PlanSerializer,
    PlanUpdateSerializer,
    PlatformLoginSerializer,
    PlatformMeSerializer,
    PlatformTokenRefreshSerializer,
    SubscriptionCreateSerializer,
    SubscriptionSerializer,
    SubscriptionUpdateSerializer,
    TenantCreateSerializer,
    TenantSerializer,
    TenantUpdateSerializer,
    UsageSnapshotSerializer,
)
from apps.platformadmin.services import PlatformAuthError, authenticate_platform_user
from apps.platformadmin.throttles import PlatformAdminThrottle, PlatformAuthThrottle
from apps.platformadmin.tokens import issue_platform_tokens
from apps.tenants.constants import TenantStatus
from core.openapi import operation
from core.pagination import EnvelopePageNumberPagination
from core.responses import ServiceError, error, ok


class PlatformTokenObtainView(APIView):
    authentication_classes: tuple = ()
    permission_classes = (AllowAny,)
    throttle_classes = (PlatformAuthThrottle,)
    schema_contract: ClassVar[dict[str, Any]] = {
        "POST": operation(request=PlatformLoginSerializer),
    }

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
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=PlatformMeSerializer),
    }

    def get(self, request: Request) -> Response:
        return ok(PlatformMeSerializer(cast("PlatformUser", request.user)).data)


def _actor(request: Request) -> PlatformUser:
    return cast("PlatformUser", request.user)


def _optional_uuid(raw: str | None, label: str) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError as exc:
        raise ServiceError("FILTER_INVALID", f"{label} must be a UUID.") from exc


def _paginated(
    request: Request,
    view: APIView,
    queryset: Any,
    serializer: type,
) -> Response:
    paginator = EnvelopePageNumberPagination()
    page: list[Any] | None = paginator.paginate_queryset(queryset, request, view=view)
    data: list[Any] = list(serializer(page, many=True).data)
    return paginator.get_paginated_response(data)


class _PlatformAPIView(APIView):
    authentication_classes = (PlatformJWTAuthentication,)
    permission_classes = (IsAuthenticated, PlatformRolePermission)
    throttle_classes = (PlatformAdminThrottle,)
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {}

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)


class PlanListView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": ALL_PLATFORM_ROLES,
        "POST": (PlatformUser.Role.SUPER_ADMIN,),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=PlanSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=PlanCreateSerializer,
            response=PlanSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        include_inactive = request.query_params.get("include_inactive", "").lower() in {
            "1",
            "true",
            "yes",
        }
        return _paginated(
            request,
            self,
            selectors.list_plans(_actor(request), include_inactive=include_inactive),
            PlanSerializer,
        )

    def post(self, request: Request) -> Response:
        serializer = PlanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = services.create_plan(
            actor=_actor(request),
            request=request,
            **serializer.validated_data,
        )
        return ok(PlanSerializer(plan).data, status.HTTP_201_CREATED)


class PlanDetailView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": ALL_PLATFORM_ROLES,
        "PATCH": (PlatformUser.Role.SUPER_ADMIN,),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=PlanSerializer),
        "PATCH": operation(request=PlanUpdateSerializer, response=PlanSerializer),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        return ok(PlanSerializer(selectors.get_plan(_actor(request), pk)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        serializer = PlanUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        plan = services.update_plan(
            selectors.get_plan(_actor(request), pk),
            actor=_actor(request),
            changes=serializer.validated_data,
            request=request,
        )
        return ok(PlanSerializer(plan).data)


class TenantListView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": ALL_PLATFORM_ROLES,
        "POST": (PlatformUser.Role.SUPER_ADMIN,),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=TenantSerializer, response_many=True, paginated=True),
        "POST": operation(
            request=TenantCreateSerializer,
            response=TenantSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request) -> Response:
        raw_status = request.query_params.get("status", "").upper()
        if raw_status and raw_status not in dict(TenantStatus.CHOICES):
            raise ServiceError("FILTER_INVALID", "Unknown tenant status.")
        queryset = selectors.list_tenants(
            _actor(request),
            status=raw_status,
            search=request.query_params.get("search", "").strip(),
            plan_id=_optional_uuid(request.query_params.get("plan"), "plan"),
        )
        return _paginated(request, self, queryset, TenantSerializer)

    def post(self, request: Request) -> Response:
        serializer = TenantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant = provision_tenant(
            actor=_actor(request),
            request=request,
            **serializer.validated_data,
        )
        return ok(TenantSerializer(tenant).data, status.HTTP_201_CREATED)


class TenantDetailView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": ALL_PLATFORM_ROLES,
        "PATCH": (PlatformUser.Role.SUPER_ADMIN,),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(response=TenantSerializer),
        "PATCH": operation(request=TenantUpdateSerializer, response=TenantSerializer),
    }

    def get(self, request: Request, pk: UUID) -> Response:
        return ok(TenantSerializer(selectors.get_tenant(_actor(request), pk)).data)

    def patch(self, request: Request, pk: UUID) -> Response:
        serializer = TenantUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        tenant = services.update_tenant(
            selectors.get_tenant(_actor(request), pk),
            actor=_actor(request),
            changes=serializer.validated_data,
            request=request,
        )
        return ok(TenantSerializer(tenant).data)


class SubscriptionListView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": ALL_PLATFORM_ROLES,
        "POST": (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.BILLING),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=SubscriptionSerializer,
            response_many=True,
            paginated=True,
        ),
        "POST": operation(
            request=SubscriptionCreateSerializer,
            response=SubscriptionSerializer,
            status_code=201,
        ),
    }

    def get(self, request: Request, tenant_pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        return _paginated(
            request,
            self,
            selectors.list_subscriptions(tenant, _actor(request)),
            SubscriptionSerializer,
        )

    def post(self, request: Request, tenant_pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        serializer = SubscriptionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subscription = tenant_services.create_subscription(
            tenant,
            actor=_actor(request),
            request=request,
            **serializer.validated_data,
        )
        return ok(SubscriptionSerializer(subscription).data, status.HTTP_201_CREATED)


class SubscriptionDetailView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "PATCH": (PlatformUser.Role.SUPER_ADMIN, PlatformUser.Role.BILLING),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "PATCH": operation(
            request=SubscriptionUpdateSerializer,
            response=SubscriptionSerializer,
        ),
    }

    def patch(self, request: Request, tenant_pk: UUID, pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        serializer = SubscriptionUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        subscription = tenant_services.update_subscription(
            selectors.get_subscription(tenant, _actor(request), pk),
            actor=_actor(request),
            changes=serializer.validated_data,
            request=request,
        )
        return ok(SubscriptionSerializer(subscription).data)


class TenantUsageView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {"GET": ALL_PLATFORM_ROLES}
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=UsageSnapshotSerializer,
            response_many=True,
            paginated=True,
        ),
    }

    def get(self, request: Request, tenant_pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        return _paginated(
            request,
            self,
            selectors.list_usage(tenant, _actor(request)),
            UsageSnapshotSerializer,
        )


class FeatureOverrideListView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "GET": ALL_PLATFORM_ROLES,
        "POST": (PlatformUser.Role.SUPER_ADMIN,),
    }
    schema_contract: ClassVar[dict[str, Any]] = {
        "GET": operation(
            response=FeatureOverrideSerializer,
            response_many=True,
            paginated=True,
        ),
        "POST": operation(
            request=FeatureOverrideSetSerializer,
            response=FeatureOverrideSerializer,
            status_code=(200, 201),
        ),
    }

    def get(self, request: Request, tenant_pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        return _paginated(
            request,
            self,
            selectors.list_feature_overrides(tenant, _actor(request)),
            FeatureOverrideSerializer,
        )

    def post(self, request: Request, tenant_pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        serializer = FeatureOverrideSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        override, created = tenant_services.set_feature_override(
            tenant,
            actor=_actor(request),
            request=request,
            **serializer.validated_data,
        )
        return ok(
            FeatureOverrideSerializer(override).data,
            status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FeatureOverrideDetailView(_PlatformAPIView):
    roles_by_method: ClassVar[dict[str, tuple[str, ...]]] = {
        "DELETE": (PlatformUser.Role.SUPER_ADMIN,)
    }
    schema_contract: ClassVar[dict[str, Any]] = {"DELETE": operation()}

    def delete(self, request: Request, tenant_pk: UUID, pk: UUID) -> Response:
        tenant = selectors.get_tenant(_actor(request), tenant_pk)
        override = selectors.get_feature_override(tenant, _actor(request), pk)
        tenant_services.delete_feature_override(
            override,
            actor=_actor(request),
            request=request,
        )
        return ok({"deleted": str(pk)})
