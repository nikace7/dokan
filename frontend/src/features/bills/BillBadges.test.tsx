import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { afterEach, expect, it } from 'vitest';

import { TenderBadges } from '@/features/bills/BillBadges';

afterEach(() => i18n.changeLanguage('en'));

it('says how a bill was paid in the chosen language', async () => {
  await i18n.changeLanguage('ne');
  render(
    <TenderBadges
      bill={{
        tenders: [
          { method: 'CASH', amount: '100.00' },
          { method: 'CREDIT', amount: '50.00' },
        ],
        due_amount: '50.00',
      }}
    />,
  );
  expect(screen.getByText('नगद')).toBeInTheDocument();
  expect(screen.getByText('उधारो')).toBeInTheDocument();
});
