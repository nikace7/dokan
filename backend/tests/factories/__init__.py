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
from tests.factories.catalog import (
    BrandFactory,
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    SizeChartFactory,
)
from tests.factories.customers import CustomerFactory
from tests.factories.inventory import (
    StockBatchFactory,
    StockLevelFactory,
    StockMovementFactory,
)
from tests.factories.pricing import (
    ItemCategoryPriceFactory,
    ItemPriceFactory,
    PriceChangeLogFactory,
    RateTypeFactory,
)
from tests.factories.purchasing import (
    PurchaseInvoiceFactory,
    PurchaseInvoiceItemFactory,
    SupplierFactory,
)
from tests.factories.sales import (
    NumberSequenceFactory,
    SalesInvoiceFactory,
    SalesInvoiceItemFactory,
)
from tests.factories.tenant import PlanFactory, TenantFactory

__all__ = [
    "DEFAULT_PASSWORD",
    "BranchFactory",
    "BrandFactory",
    "CategoryFactory",
    "CustomerFactory",
    "ItemCategoryPriceFactory",
    "ItemFactory",
    "ItemPriceFactory",
    "ItemVariantFactory",
    "NumberSequenceFactory",
    "PlanFactory",
    "PriceChangeLogFactory",
    "PurchaseInvoiceFactory",
    "PurchaseInvoiceItemFactory",
    "RateTypeFactory",
    "RoleFactory",
    "RolePermissionFactory",
    "SalesInvoiceFactory",
    "SalesInvoiceItemFactory",
    "SizeChartFactory",
    "StockBatchFactory",
    "StockLevelFactory",
    "StockMovementFactory",
    "SupplierFactory",
    "TenantFactory",
    "UserFactory",
    "UserRoleFactory",
]
