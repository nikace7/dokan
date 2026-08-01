"""Factory for audit log rows."""

from factory import SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.audit.models import AuditLog
from tests.factories.accounts import UserFactory
from tests.factories.tenant import TenantFactory


class AuditLogFactory(DjangoModelFactory):
    class Meta:
        model = AuditLog

    tenant = SubFactory(TenantFactory)
    actor = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))
    action = Sequence(lambda n: f"test.action.{n}")
    target_type = "test"
    target_id = Sequence(lambda n: __import__("uuid").uuid4())
