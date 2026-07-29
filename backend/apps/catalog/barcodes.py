"""Barcode validation (ADR 0003, docs/DECISIONS/0003-barcode-format.md).

- In-house generated codes: Code 128 — validated for the allowed printable
  ASCII character range.
- Supplier-pre-labelled goods: EAN-13 accepted as-is, but checksum-validated
  so a mis-typed manual entry is caught at write time instead of poisoning
  the POS lookup hot path.
"""

import string
from typing import Final

#: Code 128 printable-ASCII payloads, bounded for label practicality.
_CODE128_CHARS: Final = frozenset(string.printable[:95])  # 0x20..0x7E
_CODE128_MAX_LENGTH: Final = 48


class BarcodeValidationError(ValueError):
    """Raised when a barcode fails ADR 0003 validation."""


def is_valid_ean13(value: str) -> bool:
    """True when ``value`` is 13 digits with a valid EAN-13 check digit."""
    if len(value) != 13 or not value.isdigit():
        return False
    digits = [int(d) for d in value]
    weighted = sum(d * (1 if i % 2 == 0 else 3) for i, d in enumerate(digits[:12]))
    return (10 - weighted % 10) % 10 == digits[12]


def is_valid_code128(value: str) -> bool:
    """True when ``value`` fits the Code 128 printable-ASCII contract."""
    return 0 < len(value) <= _CODE128_MAX_LENGTH and all(char in _CODE128_CHARS for char in value)


def validate_barcode(value: str) -> str:
    """Validate a barcode for storage on item_variant.barcode.

    Accepts a checksum-valid EAN-13 or any Code 128 printable-ASCII payload.
    Returns the value unchanged (stored as-is — no relabelling, ADR 0003).
    Raises BarcodeValidationError otherwise.
    """
    candidate = value.strip()
    if candidate.isdigit() and len(candidate) == 13:
        if is_valid_ean13(candidate):
            return candidate
        msg = "EAN-13 check digit is invalid — check the number for typing mistakes."
        raise BarcodeValidationError(msg)
    if is_valid_code128(candidate):
        return candidate
    msg = (
        "Barcode must be a valid EAN-13 or a Code 128 payload "
        f"(printable ASCII, up to {_CODE128_MAX_LENGTH} characters)."
    )
    raise BarcodeValidationError(msg)
