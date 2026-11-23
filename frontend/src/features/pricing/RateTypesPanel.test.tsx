import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { RateTypesPanel } from '@/features/pricing/RateTypesPanel';

vi.mock('@/features/settings/api', () => ({ listPermissions: () => Promise.resolve([]) }));

const rate = (id: string, name: string) => ({
  id,
  code: name.toLowerCase(),
  name,
  name_np: null,
  is_default: false,
  sort_order: 0,
  default_margin_pct: null,
  required_permission: null,
  is_active: true,
});

it('loads the rate type being edited when switching without closing the form', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RateTypesPanel canEdit rates={[rate('r-1', 'Retail'), rate('r-2', 'Wholesale')]} />
    </QueryClientProvider>,
  );
  const [editRetail, editWholesale] = screen.getAllByRole('button', { name: 'Edit' });

  fireEvent.click(editRetail);
  expect(screen.getByLabelText('Rate name')).toHaveValue('Retail');
  fireEvent.click(editWholesale);
  expect(screen.getByLabelText('Rate name')).toHaveValue('Wholesale');
  fireEvent.click(screen.getByRole('button', { name: 'New rate type' }));
  expect(screen.getByLabelText('Rate name')).toHaveValue('');
});
