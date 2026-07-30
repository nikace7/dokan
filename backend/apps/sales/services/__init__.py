"""Sales services — write-side use cases, one transaction each.

Split by use case per AGENTS.md: ``create_sale`` (the completion pipeline)
and ``held_bills`` (park/resume/complete/cancel).
"""

from apps.sales.services.create_sale import (
    PAYMENT_METHODS,
    SaleLineInput,
    SaleResult,
    create_sale,
)
from apps.sales.services.held_bills import (
    cancel_held_bill,
    complete_held_bill,
    hold_bill,
)

__all__ = [
    "PAYMENT_METHODS",
    "SaleLineInput",
    "SaleResult",
    "cancel_held_bill",
    "complete_held_bill",
    "create_sale",
    "hold_bill",
]
