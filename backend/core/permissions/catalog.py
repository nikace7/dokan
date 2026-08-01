"""Permission catalog — the single source of truth (docs/SYSTEM_DESIGN.md §8.5).

The ``permission`` table is a DB mirror of this list; the accounts migration
seeds it and future migrations keep it in sync. Sensitive permissions get
extra audit when exercised.
"""

from typing import Final, NamedTuple


class PermissionDef(NamedTuple):
    """One grantable permission."""

    code: str
    module: str
    name: str
    sensitive: bool = False


PERMISSIONS: Final[list[PermissionDef]] = [
    # Sales
    PermissionDef("sale.view", "Sales", "View bills"),
    PermissionDef("sale.create", "Sales", "Create bills"),
    PermissionDef("sale.void", "Sales", "Cancel a bill", sensitive=True),
    PermissionDef("sale.return", "Sales", "Process returns"),
    PermissionDef("sale.discount", "Sales", "Apply discount"),
    # Catalog
    PermissionDef("catalog.view", "Catalog", "View items, categories, brands"),
    PermissionDef("catalog.manage", "Catalog", "Create and edit catalog entries"),
    # Pricing
    PermissionDef("pricing.view", "Pricing", "View rate types and prices"),
    PermissionDef("pricing.view_cost", "Pricing", "See cost price", sensitive=True),
    PermissionDef("pricing.edit", "Pricing", "Change selling prices"),
    PermissionDef("pricing.override_min", "Pricing", "Sell below minimum price", sensitive=True),
    PermissionDef("pricing.set_bounds", "Pricing", "Set min/max selling price", sensitive=True),
    # Stock
    PermissionDef("stock.view", "Stock", "View stock levels"),
    PermissionDef("stock.adjust", "Stock", "Adjust stock", sensitive=True),
    PermissionDef("stock.purchase", "Stock", "Enter purchases"),
    # Customers
    PermissionDef("customer.view", "Customers", "View customers and balances"),
    PermissionDef("customer.manage", "Customers", "Create and edit customers"),
    PermissionDef("customer.credit", "Customers", "Sell on udharo / adjust credit limit"),
    # Payments
    PermissionDef("payment.receive", "Payments", "Receive customer payments"),
    PermissionDef("payment.pay", "Payments", "Pay suppliers"),
    PermissionDef("payment.view", "Payments", "View payments and ledgers"),
    PermissionDef("cash.manage", "Payments", "Open and close cash sessions"),
    # Expenses
    PermissionDef("expense.view", "Expenses", "View expenses and summaries"),
    PermissionDef("expense.manage", "Expenses", "Record and edit expenses"),
    # Reports
    PermissionDef("report.sales", "Reports", "View sales reports"),
    PermissionDef("report.staff", "Reports", "View staff performance reports"),
    PermissionDef("report.stock", "Reports", "View stock reports"),
    PermissionDef("report.profit", "Reports", "View profit reports", sensitive=True),
    PermissionDef("report.ledger", "Reports", "View receivables/payables"),
    PermissionDef("report.cash", "Reports", "View cash book / day close"),
    PermissionDef("report.vat", "Reports", "View VAT registers"),
    PermissionDef("report.expense", "Reports", "View expense reports"),
    # Admin
    PermissionDef("user.manage", "Admin", "Manage users and roles", sensitive=True),
    PermissionDef("settings.manage", "Admin", "Change tenant settings", sensitive=True),
]

ALL_CODES: Final = frozenset(p.code for p in PERMISSIONS)
