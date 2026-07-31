"""Reports selectors — read-side only, no models, no caching layer yet.

Conventions (docs/SYSTEM_DESIGN.md §5, AGENTS.md):
- Every selector takes an explicit ``user``; cost data exists only behind
  ``pricing.view_cost`` (dropped at the selector, invariant 10).
- Reports are plain indexed GROUP BYs on the denormalized BS columns
  (``business_date_bs`` char(10) sorts lexicographically; its 7-char prefix
  IS the BS month — grouping needs no date conversion anywhere).
- BS-native parameters: date ranges are BS strings 'YYYY-MM-DD' (this is
  the one place the API speaks BS; §6.4 allows report endpoints to accept
  date_from_bs/date_to_bs and convert at the boundary — here it is
  literally a string comparison on the indexed column).
"""

from apps.reports.selectors.financial import (
    dues_report,
    profit_report,
)
from apps.reports.selectors.sales import (
    daily_sales,
    item_sales,
    monthly_sales,
)
from apps.reports.selectors.stock import (
    dead_stock,
    low_stock,
    stock_summary,
)
from apps.reports.selectors.vat import (
    purchase_vat_register,
    sales_vat_register,
)

__all__ = [
    "daily_sales",
    "dead_stock",
    "dues_report",
    "item_sales",
    "low_stock",
    "monthly_sales",
    "profit_report",
    "purchase_vat_register",
    "sales_vat_register",
    "stock_summary",
]
