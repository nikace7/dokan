import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          id="bs-from"
          label="From (BS)"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="2083-04-01"
          className="w-36"
        />
        <Input
          id="bs-to"
          label="To (BS)"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="2083-04-32"
          className="w-36"
        />
        <Button size="md" onClick={apply}>
          Apply
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
