"""Thin SMS receipt and owner-visible delivery log endpoints."""

from typing import Any, ClassVar

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications import selectors, services
from apps.notifications.serializers import ReceiptSmsSerializer, SmsLogSerializer
from apps.sales import selectors as sale_selectors
from core.middleware.tenant import require_request_tenant
from core.pagination import EnvelopePageNumberPagination
from core.permissions import HasPermission
from core.responses import ServiceError, error, ok


def _user(request: Request) -> Any:
    return request.user  # IsAuthenticated via HasPermission


class _NotificationsAPIView(APIView):
    permission_classes = (HasPermission,)
    plan_features_by_method: ClassVar[dict[str, str]] = {
        "GET": "sms",
        "POST": "sms",
    }

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, ServiceError):
            return error(exc.http_status, exc.code, exc.message)
        return super().handle_exception(exc)


class SmsLogListView(_NotificationsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"GET": "settings.manage"}

    def get(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        qs = selectors.list_sms_logs(
            tenant,
            _user(request),
            status=request.query_params.get("status", ""),
            template=request.query_params.get("template", ""),
        )
        paginator = EnvelopePageNumberPagination()
        page: list[Any] | None = paginator.paginate_queryset(qs, request, view=self)
        serializer: Any = SmsLogSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class ReceiptSmsView(_NotificationsAPIView):
    method_permissions: ClassVar[dict[str, str]] = {"POST": "sale.create"}

    def post(self, request: Request) -> Response:
        tenant = require_request_tenant(request)
        serializer = ReceiptSmsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invoice = sale_selectors.get_invoice(tenant, _user(request), data["invoice"])
        if invoice is None:
            return error(404, "INVOICE_NOT_FOUND", "Invoice not found.")
        row = services.queue_receipt_sms(tenant, invoice=invoice, to_phone=data.get("to_phone"))
        return ok(SmsLogSerializer(row).data, status.HTTP_201_CREATED)
