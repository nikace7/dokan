"""Quantity display helper."""

from decimal import Decimal


def format_qty(qty: Decimal) -> str:
    """A stored quantity as a person writes it: ``10.000`` is ``10``."""
    return f"{qty.normalize():f}"
