import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import type { BsRange } from '@/features/reports/api';

const BS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface BsRangeControlsProps {
  value: BsRange;
  onApply: (range: BsRange) => void;
}

/**
 * BS date-range inputs ('YYYY-MM-DD', zero-padded — the API compares them
 * lexicographically, so format matters). Validation is format-only; the
 * server validates actual BS calendar dates.
 */
export function BsRangeControls({ value, onApply }: BsRangeControlsProps) {
  const [from, setFrom] = useState(value.dateFromBs);
  const [to, setTo] = useState(value.dateToBs);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    if (!BS_DATE_RE.test(from.trim()) || !BS_DATE_RE.test(to.trim())) {
      setError('Use BS dates as YYYY-MM-DD (e.g. 2083-04-01).');
      return;
    }
    if (from.trim() > to.trim()) {
      setError('From date cannot be after the to date.');
      return;
    }
    setError(null);
    onApply({ dateFromBs: from.trim(), dateToBs: to.trim() });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="bs-from" className="text-sm font-medium text-slate-700">
          From (BS)
        </label>
        <input
          id="bs-from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="2083-04-01"
          className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="bs-to" className="text-sm font-medium text-slate-700">
          To (BS)
        </label>
        <input
          id="bs-to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="2083-04-32"
          className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <Button size="md" onClick={apply}>
        Apply
      </Button>
      {error ? (
        <p role="alert" className="self-center text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
