"""Factory for tenant-scoped Customer rows."""

from factory import Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.customers.models import Customer
from tests.factories.tenant import TenantFactory


class CustomerFactory(DjangoModelFactory):
    class Meta:
        model = Customer

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Customer {n}")
    phone = Sequence(lambda n: f"97{n:08d}")
