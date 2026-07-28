"""Bikram Sambat (BS) conversion — the ONLY module allowed to touch it.

Rules (docs/SYSTEM_DESIGN.md §6):
- API and storage use AD ISO strings; BS is a presentation/reporting concern.
- ``business_date_bs`` is stored zero-padded as ``char(10)`` '2082-04-12' so
  it sorts and ranges lexicographically.
- ``fiscal_year_bs`` is stored as ``char(7)`` '2082-83'; the Nepali fiscal
  year runs Shrawan 1 (month 04) → Ashad end (month 03 of the next BS year).
- Out-of-range input is a validation error, never a silent wrong date.
- A golden fixture (~500 AD↔BS pairs, shared with the frontend) pins the
  conversion table: ``core/tests/fixtures/bs_golden.json``.
"""

import re
from datetime import date, datetime
from typing import Final
from zoneinfo import ZoneInfo

import nepali_datetime

# nepali-datetime's conversion table covers BS 1975-01-01 .. 2100-12-30,
# which spans AD 1918 .. 2044 — well past this product's horizon.
SUPPORTED_RANGE_BS: Final[tuple[tuple[int, int, int], tuple[int, int, int]]] = (
    (1975, 1, 1),
    (2100, 12, 30),
)

_BS_FORMAT = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

# Nepali fiscal year boundary: Shrawan is BS month 4.
_FISCAL_YEAR_START_MONTH: Final = 4

KATHMANDU_TZ: Final = "Asia/Kathmandu"


class OutOfRangeError(ValueError):
    """Raised when a date falls outside the supported conversion table."""


def _check_bs_range(year: int, month: int, day: int) -> None:
    """Reject BS dates outside the library's conversion table."""
    lo, hi = SUPPORTED_RANGE_BS
    if not (lo <= (year, month, day) <= hi):
        msg = (
            f"BS date {year:04d}-{month:02d}-{day:02d} is outside the supported "
            f"range {lo[0]}-{lo[1]:02d}-{lo[2]:02d} .. {hi[0]}-{hi[1]:02d}-{hi[2]:02d}."
        )
        raise OutOfRangeError(msg)


def _to_bs(d: date) -> nepali_datetime.date:
    """Convert AD → library BS date, normalizing out-of-table failures."""
    try:
        return nepali_datetime.date.from_datetime_date(d)
    except (OverflowError, ValueError) as exc:
        msg = f"AD date {d.isoformat()} is outside the supported conversion table."
        raise OutOfRangeError(msg) from exc


def ad_to_bs(d: date) -> str:
    """Convert an AD date to a zero-padded BS string ``'YYYY-MM-DD'``.

    Raises OutOfRangeError if the result is outside the conversion table.
    """
    bs = _to_bs(d)
    _check_bs_range(bs.year, bs.month, bs.day)
    return f"{bs.year:04d}-{bs.month:02d}-{bs.day:02d}"


def bs_to_ad(bs: str) -> date:
    """Convert a zero-padded BS string ``'YYYY-MM-DD'`` to an AD date.

    Raises ValueError on malformed input, OutOfRangeError outside the table.
    """
    match = _BS_FORMAT.match(bs)
    if match is None:
        msg = f"BS date must be zero-padded 'YYYY-MM-DD', got {bs!r}."
        raise ValueError(msg)
    year, month, day = (int(part) for part in match.groups())
    _check_bs_range(year, month, day)
    return nepali_datetime.date(year, month, day).to_datetime_date()


def fiscal_year_bs(d: date) -> str:
    """Return the Nepali fiscal year for an AD date, e.g. ``'2082-83'``.

    The fiscal year runs Shrawan 1 (BS month 04) through Ashad end (BS month
    03 of the following BS year).
    """
    bs = _to_bs(d)
    _check_bs_range(bs.year, bs.month, bs.day)
    start_year = bs.year if bs.month >= _FISCAL_YEAR_START_MONTH else bs.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def today_bs() -> str:
    """Return today's BS date string in the Asia/Kathmandu timezone."""
    return ad_to_bs(datetime.now(tz=ZoneInfo(KATHMANDU_TZ)).date())
