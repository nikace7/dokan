"""Tests for shared API response/error primitives."""

import pytest

from core.responses import not_found_code


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Item", "ITEM_NOT_FOUND"),
        ("Rate type", "RATE_TYPE_NOT_FOUND"),
        ("Purchase invoice", "PURCHASE_INVOICE_NOT_FOUND"),
        ("Size-chart / row", "SIZE_CHART_ROW_NOT_FOUND"),
    ],
)
def test_not_found_code_is_machine_readable(label: str, expected: str) -> None:
    assert not_found_code(label) == expected
