"""Factory for tenant-scoped Branch rows."""

from factory import LazyAttribute, Sequence, SubFactory
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
    # A shop's first branch bills as INV; later ones need their own prefix.
    invoice_prefix = LazyAttribute(
        lambda branch: (
            branch.code if Branch.objects.filter(tenant=branch.tenant).exists() else "INV"
        )
    )
    is_default = False
