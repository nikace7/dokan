"""Tests for core/quantity.py — quantities as a person writes them."""

from decimal import Decimal

import pytest

from core.quantity import format_qty


@pytest.mark.parametrize(
    ("qty", "shown"),
    [("10.000", "10"), ("0.000", "0"), ("100", "100"), ("2.500", "2.5"), ("-3.000", "-3")],
)
def test_drops_trailing_zeros_and_nothing_else(qty: str, shown: str) -> None:
    assert format_qty(Decimal(qty)) == shown
