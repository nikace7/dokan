"""factory_boy factories.

Convention (docs/SYSTEM_DESIGN.md §8.7): every factory for a tenant-scoped
model hangs off :class:`TenantFactory`, so no test can accidentally create
cross-tenant data::

    class ItemFactory(DjangoModelFactory):
        tenant = SubFactory(TenantFactory)
"""

from tests.factories.accounts import (
    DEFAULT_PASSWORD,
    AccountOtpFactory,
    AuthSessionFactory,
    RoleFactory,
    RolePermissionFactory,
    UserFactory,
    UserRoleFactory,
)
from tests.factories.audit import AuditLogFactory
from tests.factories.branch import BranchFactory
from tests.factories.catalog import (
    BrandFactory,
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    SizeChartFactory,
)
from tests.factories.compliance import CbmsSyncLogFactory
from tests.factories.customers import CustomerFactory
from tests.factories.expenses import ExpenseCategoryFactory, ExpenseFactory
from tests.factories.inventory import (
    StockBatchFactory,
    StockCountFactory,
    StockCountItemFactory,
    StockLevelFactory,
    StockMovementFactory,
    StockTransferFactory,
    StockTransferItemFactory,
)
from tests.factories.notifications import SmsLogFactory
from tests.factories.payments import (
    CashSessionFactory,
    PaymentAllocationFactory,
    PaymentFactory,
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
from tests.factories.storefront import (
    StoreCustomerFactory,
    StoreOrderFactory,
    StoreOrderItemFactory,
    StoreOtpFactory,
    StoreSettingsFactory,
)
from tests.factories.tenant import PlanFactory, TenantFactory

__all__ = [
    "DEFAULT_PASSWORD",
    "AccountOtpFactory",
    "AuditLogFactory",
    "AuthSessionFactory",
    "BranchFactory",
    "BrandFactory",
    "CashSessionFactory",
    "CategoryFactory",
    "CbmsSyncLogFactory",
    "CustomerFactory",
    "ExpenseCategoryFactory",
    "ExpenseFactory",
    "ItemCategoryPriceFactory",
    "ItemFactory",
    "ItemPriceFactory",
    "ItemVariantFactory",
    "NumberSequenceFactory",
    "PaymentAllocationFactory",
    "PaymentFactory",
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
    "SmsLogFactory",
    "StockBatchFactory",
    "StockCountFactory",
    "StockCountItemFactory",
    "StockLevelFactory",
    "StockMovementFactory",
    "StockTransferFactory",
    "StockTransferItemFactory",
    "StoreCustomerFactory",
    "StoreOrderFactory",
    "StoreOrderItemFactory",
    "StoreOtpFactory",
    "StoreSettingsFactory",
    "SupplierFactory",
    "TenantFactory",
    "UserFactory",
    "UserRoleFactory",
]
