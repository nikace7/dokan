"""Authenticated tenant-staff online-order inbox and actions."""

from typing import TYPE_CHECKING, Any, ClassVar, cast

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.storefront import selectors_orders, services_fulfillment
from apps.storefront.models import StoreOrder
from apps.storefront.serializers_order import management_order_payload
from core.middleware.tenant import require_request_tenant
from core.openapi import object_list, operation
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok

if TYPE_CHECKING:
    from apps.accounts.models import User


class _OrderManagementView(APIView):
    permission_classes = (HasPermission,)
    plan_features_by_method: ClassVar[dict[str, str]] = {
        "GET": "ecommerce",
        "POST": "ecommerce",
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)


class StoreOrderManagementListView(_OrderManagementView):
    required_permission = "sale.view"
    schema_contract: ClassVar[dict[str, Any]] = {"GET": operation(response=object_list())}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        status = request.query_params.get("status", "").strip().upper()
        if status and status not in StoreOrder.Status.values:
            raise ServiceError("STATUS_INVALID", "Unknown order status.", http_status=400)
        orders = selectors_orders.list_orders(tenant, status=status)
        return ok([management_order_payload(order) for order in orders])


class StoreOrderPrepareView(_OrderManagementView):
    required_permission = "sale.create"
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request, pk: str) -> Response:
        order = services_fulfillment.prepare_order(
            require_request_tenant(request),
            order_id=pk,
            actor=cast("User", request.user),
        )
        return ok(management_order_payload(order))


class StoreOrderAdvanceView(_OrderManagementView):
    required_permission = "sale.create"
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request, pk: str) -> Response:
        order = services_fulfillment.advance_order(
            require_request_tenant(request),
            order_id=pk,
            actor=cast("User", request.user),
        )
        return ok(management_order_payload(order))


class StoreOrderCancelView(_OrderManagementView):
    required_permission = "sale.void"
    schema_contract: ClassVar[dict[str, Any]] = {"POST": operation()}

    def post(self, request: Request, pk: str) -> Response:
        order = services_fulfillment.cancel_order(
            require_request_tenant(request),
            order_id=pk,
            actor=cast("User", request.user),
        )
        return ok(management_order_payload(order))
