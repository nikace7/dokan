/**
 * Bikram Sambat (BS) conversion — the ONLY module in the frontend that may
 * import `nepali-date-converter` (ARCHITECTURE §6 invariant 9; mirrors the
 * backend's `core/calendar/bs.py` contract in docs/SYSTEM_DESIGN.md §6.3).
 *
 * Rules:
 * - The API always exchanges **AD ISO strings** (`2025-07-27`). BS exists
 *   only for presentation and reporting here.
 * - Out-of-range input throws `BsDateError` with a clear message — never a
 *   silent wrong date.
 * - The backend and frontend must pin the same conversion-table version;
 *   the shared golden fixture of known AD↔BS pairs lands with the first
 *   date-dependent feature and must run on both sides.
 *
 * NOTE: the design doc's target SUPPORTED_RANGE is BS 1970–2100, but the
 * installed library (nepali-date-converter 3.4.0) covers BS 2000-01-01 →
 * 2090-12-30 only. The narrower library range is the effective limit until
 * a wider table is adopted on both sides.
 */
import NepaliDate from 'nepali-date-converter';

export class BsDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BsDateError';
  }
}

/** Inclusive range supported by the pinned conversion table (BS calendar). */
export const SUPPORTED_RANGE = {
  from: '2000-01-01',
  to: '2090-12-30',
} as const;

/** Same range expressed in AD, for guarding `adToBs`. */
const SUPPORTED_RANGE_AD = { from: '1943-04-14', to: '2034-04-13' } as const;

export interface BsDate {
  year: number;
  /** 1-based month: 1 = Baisakh … 12 = Chaitra. */
  month: number;
  day: number;
}

/** Kathmandu midnight offset: toJsDate() returns this wall time as UTC-shifted. */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Convert an AD ISO date string (`2025-07-27`) to a BS date. */
export function adToBs(adIso: string): BsDate {
  const match = ISO_DATE_RE.exec(adIso.trim());
  if (!match) {
    throw new BsDateError(`Expected an AD ISO date (YYYY-MM-DD), got ${JSON.stringify(adIso)}`);
  }
  const [, y, m, d] = match;
  const iso = `${y}-${m}-${d}`;
  if (iso < SUPPORTED_RANGE_AD.from || iso > SUPPORTED_RANGE_AD.to) {
    // The library silently wraps out-of-range AD dates into a wrong BS date
    // instead of throwing — guard explicitly so this can never happen.
    throw new BsDateError(
      `AD date ${iso} is outside the supported BS range ` +
        `${SUPPORTED_RANGE.from}–${SUPPORTED_RANGE.to} ` +
        `(AD ${SUPPORTED_RANGE_AD.from}–${SUPPORTED_RANGE_AD.to})`,
    );
  }
  // Use UTC noon to keep the AD calendar day stable across host timezones.
  const adDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
  try {
    const bs = new NepaliDate(adDate).getBS();
    return { year: bs.year, month: bs.month + 1, day: bs.date };
  } catch (error) {
    throw new BsDateError(
      `AD date ${adIso} is outside the supported BS range ` +
        `${SUPPORTED_RANGE.from}–${SUPPORTED_RANGE.to}: ${(error as Error).message}`,
    );
  }
}

/** Convert a BS date to an AD ISO date string (`YYYY-MM-DD`). */
export function bsToAd(bs: BsDate): string {
  let jsDate: Date;
  try {
    // Library months are 0-based.
    jsDate = new NepaliDate(bs.year, bs.month - 1, bs.day).toJsDate();
  } catch (error) {
    throw new BsDateError(
      `Invalid or unsupported BS date ${bs.year}-${pad2(bs.month)}-${pad2(bs.day)} ` +
        `(supported range ${SUPPORTED_RANGE.from}–${SUPPORTED_RANGE.to}): ${(error as Error).message}`,
    );
  }
  // toJsDate() is Kathmandu midnight; shift to UTC before taking the ISO day
  // so the result is host-timezone independent.
  const utcMidnight = new Date(jsDate.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
  return utcMidnight.toISOString().slice(0, 10);
}

/** Zero-padded BS string, lexicographically sortable: `2082-04-12`. */
export function toBsString(bs: BsDate): string {
  return `${bs.year}-${pad2(bs.month)}-${pad2(bs.day)}`;
}

/** Parse and calendar-validate a zero-padded BS date string. */
export function parseBsString(value: string): BsDate {
  const match = ISO_DATE_RE.exec(value.trim());
  const invalid = () => new BsDateError(`Invalid BS date ${JSON.stringify(value)}`);
  if (!match) {
    throw invalid();
  }
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const canonical = toBsString(date);
  if (
    date.month < 1 ||
    date.month > 12 ||
    date.day < 1 ||
    date.day > 32 ||
    canonical < SUPPORTED_RANGE.from ||
    canonical > SUPPORTED_RANGE.to
  ) {
    throw invalid();
  }
  try {
    const roundTrip = adToBs(bsToAd(date));
    if (toBsString(roundTrip) !== canonical) {
      throw invalid();
    }
  } catch {
    throw invalid();
  }
  return date;
}

/** Month length from the same pinned conversion table used by all BS dates. */
export function daysInBsMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new BsDateError(`Invalid BS month ${month}`);
  }
  for (let day = 32; day >= 28; day -= 1) {
    try {
      parseBsString(`${year}-${pad2(month)}-${pad2(day)}`);
      return day;
    } catch {
      // Continue to the next possible month length.
    }
  }
  throw new BsDateError(`Unsupported BS month ${year}-${pad2(month)}`);
}

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'] as const;

export function toDevanagariDigits(text: string): string {
  return text.replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]);
}

export interface FormatBsOptions {
  /** Devanagari numerals (`२०८२-०४-१२`). Default: false. */
  devanagari?: boolean;
}

/** Format a BS date for display, e.g. `2082-04-12` or `२०८२-०४-१२`. */
export function formatBs(bs: BsDate, options: FormatBsOptions = {}): string {
  const text = toBsString(bs);
  return options.devanagari ? toDevanagariDigits(text) : text;
}

/**
 * Nepali fiscal year for a BS date: Shrawan 1 (month 4) → Ashad end (month 3
 * of the next year), formatted as `2082-83`.
 */
export function fiscalYearBs(bs: BsDate): string {
  if (bs.month < 1 || bs.month > 12) {
    throw new BsDateError(`Invalid BS month: ${String(bs.month)}`);
  }
  const startYear = bs.month >= 4 ? bs.year : bs.year - 1;
  const endSuffix = pad2((startYear + 1) % 100);
  return `${startYear}-${endSuffix}`;
}
