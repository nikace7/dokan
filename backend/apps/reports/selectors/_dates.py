"""BS month boundary helper — the ONLY date arithmetic in reports.

Month-length lookup goes through the conversion table (core/calendar/bs.py)
once per request; grouping itself is pure string prefix on the denormalized
columns.
"""

from core.calendar.bs import bs_to_ad
from core.responses import ServiceError


def bs_month_bounds(bs_month: str) -> tuple[str, str]:
    """('YYYY-MM',) -> ('YYYY-MM-01', last day of that BS month)."""
    if len(bs_month) != 7 or bs_month[4] != "-":
        raise ServiceError("DATE_INVALID", "BS month must be 'YYYY-MM'.")
    try:
        for part in bs_month.split("-"):
            int(part)
    except ValueError as exc:
        raise ServiceError("DATE_INVALID", "BS month must be 'YYYY-MM'.") from exc
    for day in range(32, 28, -1):
        candidate = f"{bs_month}-{day:02d}"
        try:
            bs_to_ad(candidate)
        except ValueError:
            continue
        return f"{bs_month}-01", candidate
    raise ServiceError("DATE_INVALID", f"Invalid BS month: {bs_month}.")
