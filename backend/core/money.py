"""Money helpers — Decimal only, NPR only, Nepali display conventions.

Rules (docs/ARCHITECTURE.md, docs/SYSTEM_DESIGN.md §4–§7):
- Money is always ``Decimal``. Never float.
- Display uses Nepali lakh/crore grouping (``1,23,456.00``), not Western
  thousands grouping, with an optional Devanagari numeral rendering
  (``१,२३,४५६.००``) for Nepali-locale users.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Final, Literal

#: ISO 4217 code for the only currency this system handles.
CURRENCY_NPR: Final = "NPR"

#: Display symbol used on receipts and screens.
CURRENCY_SYMBOL: Final = "Rs"

_TWO_PLACES: Final = Decimal("0.01")

_DEVANAGARI_DIGITS: Final = str.maketrans("0123456789", "०१२३४५६७८९")


def quantize_money(value: Decimal | int | str) -> Decimal:
    """Round a money value to 2 decimal places with ROUND_HALF_UP.

    Accepts Decimal/int/str; floats are refused because they smuggle binary
    rounding error into money.
    """
    if isinstance(value, float):
        msg = "Money must be Decimal/int/str, never float."
        raise TypeError(msg)
    return Decimal(value).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _lakh_group(int_part: str) -> str:
    """Group an integer string Nepali style: last 3 digits, then pairs."""
    if len(int_part) <= 3:
        return int_part
    head, tail = int_part[:-3], int_part[-3:]
    groups: list[str] = []
    while head:
        groups.append(head[-2:])
        head = head[:-2]
    groups.reverse()
    return ",".join([*groups, tail])


def format_npr(
    amount: Decimal,
    *,
    numerals: Literal["arabic", "devanagari"] = "arabic",
    with_symbol: bool = True,
) -> str:
    """Format a Decimal as NPR with lakh/crore grouping and 2 decimals.

    Examples:
        >>> format_npr(Decimal("123456"))
        'Rs 1,23,456.00'
        >>> format_npr(Decimal("123456"), numerals="devanagari")
        'Rs १,२३,४५६.००'
    """
    quantized = quantize_money(amount)
    sign = "-" if quantized < 0 else ""
    integer, _, fraction = f"{abs(quantized):.2f}".partition(".")
    rendered = f"{sign}{_lakh_group(integer)}.{fraction}"
    if numerals == "devanagari":
        rendered = rendered.translate(_DEVANAGARI_DIGITS)
    return f"{CURRENCY_SYMBOL} {rendered}" if with_symbol else rendered
