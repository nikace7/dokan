import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BsDatePicker } from '@/features/reports/BsDatePicker';
import type { BsDatePickerProps } from '@/features/reports/BsDatePicker';
import { adToBsText, bsTextToAd } from '@/lib/dateTime';

/**
 * BS date picker for forms that store AD dates. Unreadable text is never
 * handed over: the last good value stays, and the form will not submit.
 */
export function BsDateField({
  value,
  onChange,
  ...props
}: Omit<BsDatePickerProps, 'invalidMessage'>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ ad: value, text: adToBsText(value) });
  // A value changed from outside (a form reset) replaces what was typed.
  const text = draft.ad === value ? draft.text : adToBsText(value);

  return (
    <BsDatePicker
      {...props}
      value={text}
      invalidMessage={bsTextToAd(text) === null ? t('reports.range.invalidFormat') : undefined}
      onChange={(next) => {
        const ad = bsTextToAd(next);
        setDraft({ ad: ad ?? value, text: next });
        if (ad !== null) onChange(ad);
      }}
    />
  );
}
