"""Tests for core/money.py — Decimal money and Nepali display formatting."""

from decimal import Decimal

import pytest

from core.money import CURRENCY_NPR, format_npr, quantize_money


def test_currency_is_npr() -> None:
    assert CURRENCY_NPR == "NPR"


class TestQuantizeMoney:
    def test_rounds_half_up_to_two_places(self) -> None:
        assert quantize_money("10.005") == Decimal("10.01")
        assert quantize_money("10.004") == Decimal("10.00")

    def test_accepts_decimal_int_str(self) -> None:
        assert quantize_money(Decimal("7")) == Decimal("7.00")
        assert quantize_money(7) == Decimal("7.00")
        assert quantize_money("7.1") == Decimal("7.10")

    def test_refuses_float(self) -> None:
        with pytest.raises(TypeError, match="never float"):
            quantize_money(10.5)


class TestFormatNpr:
    def test_lakh_grouping(self) -> None:
        assert format_npr(Decimal("123456")) == "Rs 1,23,456.00"
        assert format_npr(Decimal("12345678")) == "Rs 1,23,45,678.00"

    def test_small_amounts_have_no_grouping(self) -> None:
        assert format_npr(Decimal("999")) == "Rs 999.00"
        assert format_npr(Decimal("1000")) == "Rs 1,000.00"

    def test_negative_amounts(self) -> None:
        assert format_npr(Decimal("-123456")) == "Rs -1,23,456.00"

    def test_devanagari_numerals(self) -> None:
        assert format_npr(Decimal("123456"), numerals="devanagari") == "Rs १,२३,४५६.००"

    def test_without_symbol(self) -> None:
        assert format_npr(Decimal("123456"), with_symbol=False) == "1,23,456.00"
