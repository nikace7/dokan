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
from apps.sales.services.exchange import ExchangeResult, create_exchange
from apps.sales.services.held_bills import (
    cancel_held_bill,
    complete_held_bill,
    hold_bill,
)
from apps.sales.services.returns import REFUND_METHODS, ReturnLineInput, create_return

__all__ = [
    "PAYMENT_METHODS",
    "REFUND_METHODS",
    "ExchangeResult",
    "ReturnLineInput",
    "SaleLineInput",
    "SaleResult",
    "cancel_held_bill",
    "complete_held_bill",
    "create_exchange",
    "create_return",
    "create_sale",
    "hold_bill",
]
