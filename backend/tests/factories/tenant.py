"""Plan/Tenant factories — the root factories every other factory hangs off.

Convention (docs/SYSTEM_DESIGN.md §8.7): every factory for a tenant-scoped
model takes/hangs off :class:`TenantFactory`, so no test can accidentally
create cross-tenant data.
"""

from factory import Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.tenants.constants import TenantStatus
from apps.tenants.models import Plan, Tenant


class PlanFactory(DjangoModelFactory):
    """A subscription plan (platform scope)."""

    class Meta:
        model = Plan
        django_get_or_create = ("code",)

    code = Sequence(lambda n: f"plan-{n}")
    name = Sequence(lambda n: f"Plan {n}")
    price_npr = "2000.00"
    billing_cycle = Plan.BillingCycle.MONTHLY
    limits = {"max_users": 5, "max_branches": 1, "max_items": 2000}
    features = {"sms": True, "profit_reports": True}


class TenantFactory(DjangoModelFactory):
    """Creates a tenant row (platform scope, no RLS)."""

    class Meta:
        model = Tenant
        django_get_or_create = ("slug",)

    slug = Sequence(lambda n: f"shop{n:04d}")
    name = Sequence(lambda n: f"Test Shop {n}")
    plan = SubFactory(PlanFactory)
    status = TenantStatus.ACTIVE
