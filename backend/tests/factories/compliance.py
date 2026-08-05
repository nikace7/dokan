"""Factory for CBMS sync log rows."""

from factory import SelfAttribute, SubFactory
from factory.django import DjangoModelFactory

from apps.compliance.models import CbmsSyncLog
from tests.factories.sales import SalesInvoiceFactory
from tests.factories.tenant import TenantFactory


class CbmsSyncLogFactory(DjangoModelFactory):
    class Meta:
        model = CbmsSyncLog

    tenant = SubFactory(TenantFactory)
    invoice = SubFactory(SalesInvoiceFactory, tenant=SelfAttribute("..tenant"))
    payload = {"invoice_no": "INV-2082-83-000001"}
    status = CbmsSyncLog.Status.PENDING
