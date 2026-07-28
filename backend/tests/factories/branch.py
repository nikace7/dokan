"""Factory for tenant-scoped Branch rows."""

from factory import Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.tenants.models import Branch
from tests.factories.tenant import TenantFactory


class BranchFactory(DjangoModelFactory):
    """A branch; hangs off TenantFactory like every tenant-scoped factory."""

    class Meta:
        model = Branch

    tenant = SubFactory(TenantFactory)
    code = Sequence(lambda n: f"BR{n:03d}")
    name = Sequence(lambda n: f"Branch {n}")
    invoice_prefix = "INV"
    is_default = False
