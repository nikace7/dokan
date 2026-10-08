"""Least-privilege permissions for the five built-in shop roles."""

from typing import Final

from core.permissions.catalog import ALL_CODES

SYSTEM_ROLE_PERMISSIONS: Final[dict[str, frozenset[str]]] = {
    "OWNER": ALL_CODES,
    "MANAGER": ALL_CODES
    - {
        "pricing.override_min",
        "pricing.set_bounds",
        "pricing.view_cost",
        "report.profit",
        "user.manage",
    },
    "CASHIER": frozenset(
        {
            # Open and close the cash drawer: a sale needs an open cash session.
            "cash.manage",
            "catalog.view",
            "customer.credit",
            "customer.manage",
            "customer.view",
            "payment.receive",
            "pricing.view",
            "sale.create",
            "sale.discount",
            "sale.return",
            "sale.view",
            "stock.view",
        }
    ),
    "STOCK_KEEPER": frozenset(
        {
            "catalog.manage",
            "catalog.view",
            "pricing.view",
            "stock.adjust",
            "stock.purchase",
            "stock.view",
        }
    ),
    "ACCOUNTANT": frozenset(
        {
            "customer.view",
            "expense.manage",
            "expense.view",
            "payment.pay",
            "payment.receive",
            "payment.view",
            "pricing.view",
            "pricing.view_cost",
            "report.cash",
            "report.expense",
            "report.ledger",
            "report.profit",
            "report.sales",
            "report.staff",
            "report.stock",
            "report.vat",
            "sale.view",
            "stock.view",
        }
    ),
}

SYSTEM_ROLE_NAMES: Final[dict[str, str]] = {
    "OWNER": "Owner",
    "MANAGER": "Manager",
    "CASHIER": "Cashier",
    "STOCK_KEEPER": "Stock Keeper",
    "ACCOUNTANT": "Accountant",
}

assert all(codes <= ALL_CODES for codes in SYSTEM_ROLE_PERMISSIONS.values())
