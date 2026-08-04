"""Read-side SMS log queries; selectors take an explicit user argument."""

from typing import TYPE_CHECKING

from django.db.models import QuerySet

from apps.notifications.models import SmsLog

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_sms_logs(
    tenant: "Tenant", user: "User", *, status: str = "", template: str = ""
) -> QuerySet[SmsLog]:
    qs = SmsLog.objects.filter(tenant=tenant)
    if status:
        qs = qs.filter(status=status)
    if template:
        qs = qs.filter(template=template)
    return qs.order_by("-created_at")
