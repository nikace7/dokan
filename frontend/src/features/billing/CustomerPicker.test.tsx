import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { searchCustomers } from '@/features/billing/api';
import { CustomerPicker } from '@/features/billing/CustomerPicker';
import { useCartStore } from '@/stores/cartStore';

vi.mock('@/features/billing/api', async (original) => ({
  ...(await original<typeof import('@/features/billing/api')>()),
  searchCustomers: vi.fn(),
}));

beforeEach(() => {
  useCartStore.getState().setCustomer(null);
  vi.mocked(searchCustomers)
    .mockReset()
    .mockResolvedValue([{ id: 'c1', name: 'Sita Sharma', phone: '9800000001' }] as never);
});

it('sends one search for a typed name, not one per key', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomerPicker />
    </QueryClientProvider>,
  );
  const box = screen.getByRole('textbox');
  for (let n = 1; n <= 'sita sharma'.length; n += 1) {
    fireEvent.change(box, { target: { value: 'sita sharma'.slice(0, n) } });
  }

  fireEvent.click(await screen.findByRole('button', { name: /Sita Sharma/ }));

  expect(searchCustomers).toHaveBeenCalledTimes(1);
  expect(searchCustomers).toHaveBeenCalledWith('sita sharma');
  expect(useCartStore.getState().customer?.name).toBe('Sita Sharma');
});
