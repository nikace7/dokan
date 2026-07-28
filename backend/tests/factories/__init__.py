"""factory_boy factories.

Convention (docs/SYSTEM_DESIGN.md §8.7): every factory for a tenant-scoped
model hangs off :class:`TenantFactory`, so no test can accidentally create
cross-tenant data::

    class ItemFactory(DjangoModelFactory):
        tenant = SubFactory(TenantFactory)
"""

from tests.factories.accounts import (
    DEFAULT_PASSWORD,
    RoleFactory,
    RolePermissionFactory,
    UserFactory,
    UserRoleFactory,
)
from tests.factories.branch import BranchFactory
from tests.factories.tenant import PlanFactory, TenantFactory

__all__ = [
    "DEFAULT_PASSWORD",
    "BranchFactory",
    "PlanFactory",
    "RoleFactory",
    "RolePermissionFactory",
    "TenantFactory",
    "UserFactory",
    "UserRoleFactory",
]
