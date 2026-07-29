"""Unit tests for barcode validation (ADR 0003)."""

import pytest

from apps.catalog.barcodes import (
    BarcodeValidationError,
    is_valid_code128,
    is_valid_ean13,
    validate_barcode,
)

#: Checksum-valid EAN-13 (standard example).
VALID_EAN13 = "5901234123457"


class TestEan13:
    def test_valid_check_digit(self) -> None:
        assert is_valid_ean13(VALID_EAN13)

    def test_wrong_check_digit(self) -> None:
        assert not is_valid_ean13("5901234123458")

    def test_non_digits_rejected(self) -> None:
        assert not is_valid_ean13("590123412345X")

    def test_wrong_length_rejected(self) -> None:
        assert not is_valid_ean13("590123412345")
        assert not is_valid_ean13("59012341234570")


class TestCode128:
    def test_printable_ascii_accepted(self) -> None:
        assert is_valid_code128("DOKAN-TEE-BLK-M")

    def test_non_ascii_rejected(self) -> None:
        assert not is_valid_code128("TEE-☃")

    def test_empty_rejected(self) -> None:
        assert not is_valid_code128("")

    def test_overlong_rejected(self) -> None:
        assert not is_valid_code128("X" * 49)


class TestValidateBarcode:
    def test_ean13_returned_as_is(self) -> None:
        assert validate_barcode(VALID_EAN13) == VALID_EAN13

    def test_ean13_bad_check_digit_raises_with_typing_hint(self) -> None:
        with pytest.raises(BarcodeValidationError, match="check digit"):
            validate_barcode("5901234123458")

    def test_code128_accepted(self) -> None:
        assert validate_barcode("DOKAN-TEE-BLK-M") == "DOKAN-TEE-BLK-M"

    def test_surrounding_whitespace_stripped(self) -> None:
        assert validate_barcode(f"  {VALID_EAN13}  ") == VALID_EAN13

    def test_garbage_rejected(self) -> None:
        with pytest.raises(BarcodeValidationError):
            validate_barcode("☃☃☃")
