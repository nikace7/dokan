import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  adToBs,
  bsToAd,
  daysInBsMonth,
  parseBsString,
  SUPPORTED_RANGE,
  toBsString,
} from '@/lib/bs';
import { shopAdDate } from '@/lib/dateTime';
import { cn } from '@/lib/utils';

// The date tables end here; a month outside them cannot be drawn.
const FIRST_MONTH = SUPPORTED_RANGE.from.slice(0, 7);
const LAST_MONTH = SUPPORTED_RANGE.to.slice(0, 7);

function monthFromValue(value: string): { year: number; month: number } {
  try {
    const parsed = parseBsString(value);
    return { year: parsed.year, month: parsed.month };
  } catch {
    const today = adToBs(shopAdDate());
    return { year: today.year, month: today.month };
  }
}

function moveMonth(year: number, month: number, delta: number) {
  const index = year * 12 + month - 1 + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export interface BsDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  /** Why the value cannot be used; blocks the form and shows on leaving the field. */
  invalidMessage?: string;
}

/** Editable BS input paired with a calendar-native BS day grid. */
export function BsDatePicker({
  id,
  label,
  value,
  onChange,
  className,
  required,
  invalidMessage,
}: BsDatePickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [left, setLeft] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthFromValue(value));

  useEffect(() => {
    if (open) setView(monthFromValue(value));
  }, [open, value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(invalidMessage ?? '');
  }, [invalidMessage]);

  const monthDays = useMemo(() => daysInBsMonth(view.year, view.month), [view]);
  const firstWeekday = useMemo(() => {
    const ad = bsToAd({ ...view, day: 1 });
    return new Date(`${ad}T00:00:00Z`).getUTCDay();
  }, [view]);
  const selected = (() => {
    try {
      return parseBsString(value);
    } catch {
      return null;
    }
  })();

  const navigate = (delta: number) =>
    setView((current) => moveMonth(current.year, current.month, delta));
  const viewMonth = toBsString({ ...view, day: 1 }).slice(0, 7);
  const monthName = t(`common.bsMonths.${view.month}`);

  return (
    <div className={cn('flex items-end gap-1', className)}>
      <Input
        ref={inputRef}
        id={id}
        label={label}
        value={value}
        required={required}
        error={left ? invalidMessage : undefined}
        onBlur={() => setLeft(true)}
        onChange={(event) => {
          setLeft(false);
          onChange(event.target.value);
        }}
        placeholder="2083-04-01"
        inputMode="numeric"
        className="w-36"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t('reports.range.choose', { label })}>
            <CalendarDays aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('reports.range.previousMonth')}
              disabled={viewMonth <= FIRST_MONTH}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <p className="font-semibold" aria-live="polite">
              {monthName} {view.year}
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('reports.range.nextMonth')}
              disabled={viewMonth >= LAST_MONTH}
              onClick={() => navigate(1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <span key={day} aria-hidden="true" className="py-1">
                {t(`common.weekdays.${day}`)}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: monthDays }, (_, index) => index + 1).map((day) => {
              const isSelected =
                selected?.year === view.year &&
                selected.month === view.month &&
                selected.day === day;
              return (
                <Button
                  key={day}
                  variant={isSelected ? 'default' : 'ghost'}
                  size="icon"
                  className="h-9 w-9 text-xs"
                  aria-label={`${day} ${monthName} ${view.year}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onChange(toBsString({ ...view, day }));
                    setOpen(false);
                  }}
                >
                  {day}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
