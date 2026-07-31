"""Factories for purchasing: suppliers (invoice factories land with tests)."""

from factory import Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.purchasing.models import Supplier
from tests.factories.tenant import TenantFactory


class SupplierFactory(DjangoModelFactory):
    class Meta:
        model = Supplier

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Supplier {n}")
    phone = Sequence(lambda n: f"96{n:08d}")
