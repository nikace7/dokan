import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { currentBsMonthRange } from '@/features/reports/api';
import type { BsRange } from '@/features/reports/api';
import { adToBs, bsToAd, toBsString } from '@/lib/bs';

const BS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's AD date in Kathmandu — the same clock `currentBsMonthRange` uses. */
function todayAdKathmandu(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

function todayRange(): BsRange {
  const today = toBsString(adToBs(todayAdKathmandu()));
  return { dateFromBs: today, dateToBs: today };
}

/**
 * Previous BS month without needing a month-length table: the day before this
 * month's 1st (via an AD round-trip) is the previous month's last day. Null
 * when the date falls outside the conversion table's supported range — the
 * chip is then simply hidden.
 */
function lastMonthRange(): BsRange | null {
  try {
    const today = adToBs(todayAdKathmandu());
    const monthStartAd = bsToAd({ ...today, day: 1 });
    const dayBefore = new Date(`${monthStartAd}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const prevMonthEnd = adToBs(dayBefore.toISOString().slice(0, 10));
    return {
      dateFromBs: toBsString({ ...prevMonthEnd, day: 1 }),
      dateToBs: toBsString(prevMonthEnd),
    };
  } catch {
    return null;
  }
}

interface BsRangeControlsProps {
  value: BsRange;
  onApply: (range: BsRange) => void;
}

/**
 * BS date-range inputs ('YYYY-MM-DD', zero-padded — the API compares them
 * lexicographically, so format matters) with quick-range chips that fill the
 * inputs and apply immediately. Validation is format-only; the server
 * validates actual BS calendar dates.
 */
export function BsRangeControls({ value, onApply }: BsRangeControlsProps) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(value.dateFromBs);
  const [to, setTo] = useState(value.dateToBs);
  const [error, setError] = useState<string | null>(null);
  const lastMonth = useMemo(lastMonthRange, []);

  const apply = () => {
    if (!BS_DATE_RE.test(from.trim()) || !BS_DATE_RE.test(to.trim())) {
      setError(t('reports.range.invalidFormat'));
      return;
    }
    if (from.trim() > to.trim()) {
      setError(t('reports.range.fromAfterTo'));
      return;
    }
    setError(null);
    onApply({ dateFromBs: from.trim(), dateToBs: to.trim() });
  };

  const applyRange = (range: BsRange) => {
    setFrom(range.dateFromBs);
    setTo(range.dateToBs);
    setError(null);
    onApply(range);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          id="bs-from"
          label={t('reports.range.from')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="2083-04-01"
          className="w-36"
        />
        <Input
          id="bs-to"
          label={t('reports.range.to')}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="2083-04-32"
          className="w-36"
        />
        <Button size="md" onClick={apply}>
          {t('reports.range.apply')}
        </Button>
      </div>
      <div
        role="group"
        aria-label={t('reports.range.quickRanges', { defaultValue: 'Quick ranges' })}
        className="flex flex-wrap gap-1"
      >
        <Button variant="outline" size="sm" onClick={() => applyRange(todayRange())}>
          {t('reports.range.today', { defaultValue: 'Today' })}
        </Button>
        <Button variant="outline" size="sm" onClick={() => applyRange(currentBsMonthRange())}>
          {t('dashboard.thisMonth')}
        </Button>
        {lastMonth ? (
          <Button variant="outline" size="sm" onClick={() => applyRange(lastMonth)}>
            {t('reports.range.lastMonth', { defaultValue: 'Last month' })}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
