"""Generate the shared AD↔BS golden fixture (~500 pairs).

Output: ``core/tests/fixtures/bs_golden.json`` — a list of
``{"ad": "YYYY-MM-DD", "bs": "YYYY-MM-DD"}`` pairs. The frontend's
``nepali-date-converter`` tests must run against this same file so the two
conversion tables can never silently diverge.

Coverage strategy: every first/middle/last day of every BS month for a
spread of years (catches month-length variations, the leap-ish years), plus
the fiscal-year boundaries, plus a uniform AD-day sample.

Run: ``python scripts/generate_bs_golden.py`` from ``backend/``.
"""

import json
from datetime import date, timedelta
from pathlib import Path

import nepali_datetime

OUTPUT = Path(__file__).resolve().parent.parent / "core" / "tests" / "fixtures" / "bs_golden.json"

# BS years sampled across the whole supported table (1975..2100).
YEARS = [*range(1975, 2101, 5), 2056, 2081, 2082, 2083, 2084, 2099, 2100]


def bs_to_ad(year: int, month: int, day: int) -> date:
    return nepali_datetime.date(year, month, day).to_datetime_date()


def month_length(year: int, month: int) -> int:
    """Days in a BS month, derived from the library itself."""
    ad = bs_to_ad(year, month, 1)
    for day in range(32, 28, -1):
        try:
            bs_to_ad(year, month, day)
        except ValueError:
            continue
        return day
    msg = f"Could not determine length of BS {year}-{month:02d} from {ad}"
    raise RuntimeError(msg)


def main() -> None:
    pairs: dict[str, str] = {}

    def add(ad: date, bs_year: int, bs_month: int, bs_day: int) -> None:
        bs = f"{bs_year:04d}-{bs_month:02d}-{bs_day:02d}"
        assert ad.isoformat() not in pairs or pairs[ad.isoformat()] == bs
        pairs[ad.isoformat()] = bs

    for year in YEARS:
        for month in range(1, 13):
            length = month_length(year, month)
            for day in sorted({1, length // 2 + 1, length}):
                add(bs_to_ad(year, month, day), year, month, day)
        # Fiscal year boundary: Ashad end (FY close) and Shrawan 1 (FY open).
        add(bs_to_ad(year, 3, month_length(year, 3)), year, 3, month_length(year, 3))
        add(bs_to_ad(year, 4, 1), year, 4, 1)

    # Uniform AD-day sample across the supported range.
    start = bs_to_ad(YEARS[0], 1, 1)
    end = bs_to_ad(YEARS[-1], 12, month_length(YEARS[-1], 12))
    ad_day = start
    while ad_day <= end and len(pairs) < 620:
        bs = nepali_datetime.date.from_datetime_date(ad_day)
        add(ad_day, bs.year, bs.month, bs.day)
        ad_day += timedelta(days=151)

    fixture = [{"ad": ad, "bs": pairs[ad]} for ad in sorted(pairs)]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=0) + "\n", encoding="utf-8")
    print(f"Wrote {len(fixture)} pairs to {OUTPUT}")


if __name__ == "__main__":
    main()
