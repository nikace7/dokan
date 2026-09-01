import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { adToBs, bsToAd, daysInBsMonth, parseBsString, toBsString } from '@/lib/bs';
import { cn } from '@/lib/utils';

const MONTHS = [
  'Baisakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

function monthFromValue(value: string): { year: number; month: number } {
  try {
    const parsed = parseBsString(value);
    return { year: parsed.year, month: parsed.month };
  } catch {
    const todayAd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
    const today = adToBs(todayAd);
    return { year: today.year, month: today.month };
  }
}

function moveMonth(year: number, month: number, delta: number) {
  const index = year * 12 + month - 1 + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

interface BsDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Editable BS input paired with a calendar-native BS day grid. */
export function BsDatePicker({ id, label, value, onChange, className }: BsDatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthFromValue(value));

  useEffect(() => {
    if (open) setView(monthFromValue(value));
  }, [open, value]);

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
  const monthName = MONTHS[view.month - 1];

  return (
    <div className={cn('flex items-end gap-1', className)}>
      <Input
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="2083-04-01"
        inputMode="numeric"
        className="w-36"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" aria-label={`Choose ${label}`}>
            <CalendarDays aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('reports.range.previousMonth', { defaultValue: 'Previous BS month' })}
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
              aria-label={t('reports.range.nextMonth', { defaultValue: 'Next BS month' })}
              onClick={() => navigate(1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const).map((day) => (
              <span key={day} aria-hidden="true" className="py-1">
                {day}
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
