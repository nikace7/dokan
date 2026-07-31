"""Shared helpers for report selectors."""

from core.calendar.bs import today_bs
from core.responses import ServiceError

_BS_DATE_LEN = 10


def validate_bs_date(value: str, param: str) -> str:
    """Shape-check a BS date string ('YYYY-MM-DD', zero-padded char(10))."""
    valid = len(value) == _BS_DATE_LEN and value[4] == "-" and value[7] == "-"
    if valid:
        try:
            int(value[:4]), int(value[5:7]), int(value[8:])
        except ValueError:
            valid = False
    if not valid:
        raise ServiceError("DATE_INVALID", f"Parameter '{param}' must be a BS date 'YYYY-MM-DD'.")
    return value


def current_bs_month_range() -> tuple[str, str]:
    """Default range per design §5.3: the current BS month."""
    from apps.reports.selectors._dates import bs_month_bounds

    return bs_month_bounds(today_bs()[:7])


def resolve_date_range(date_from_bs: str | None, date_to_bs: str | None) -> tuple[str, str]:
    """Apply the sensible default (current BS month) and validate."""
    if date_from_bs and date_to_bs:
        validate_bs_date(date_from_bs, "date_from_bs")
        validate_bs_date(date_to_bs, "date_to_bs")
        if date_from_bs > date_to_bs:
            raise ServiceError("DATE_RANGE_INVALID", "date_from_bs cannot be after date_to_bs.")
        return date_from_bs, date_to_bs
    if date_from_bs or date_to_bs:
        raise ServiceError("DATE_RANGE_INCOMPLETE", "Provide both date_from_bs and date_to_bs.")
    return current_bs_month_range()
