"""Factory for tenant-scoped SMS delivery rows."""

from factory import Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.notifications.models import SmsLog
from tests.factories.tenant import TenantFactory


class SmsLogFactory(DjangoModelFactory):
    class Meta:
        model = SmsLog

    tenant = SubFactory(TenantFactory)
    to_phone = Sequence(lambda n: f"97798{n:08d}")
    template = "receipt"
    body = "Receipt body"
