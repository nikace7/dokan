import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingPage } from '@/features/billing/BillingPage';
import { useCartStore } from '@/stores/cartStore';

let advancedPos = false;

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    user: {
      permissions: ['sale.create'],
      plan: { code: 'basic', name: 'Basic', features: { advanced_pos: advancedPos } },
    },
  }),
}));

vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({
    branches: [],
    rateTypes: [],
    branchId: 'branch-1',
    rateTypeId: 'rate-1',
    isReady: true,
    isLoading: false,
  }),
}));

vi.mock('@/features/billing/ReceiptPanel', () => ({
  ReceiptPanel: ({ onNewBill }: { onNewBill: () => void }) => (
    <button onClick={onNewBill}>Receipt: new bill</button>
  ),
}));

const LINE = {
  variantId: 'var-1',
  sku: 'TS-BLK-M',
  label: 'T-Shirt',
  quantity: 1,
  unitPricePaisa: 70000,
  discountPaisa: 0,
};

function open() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/billing']}>
        <Routes>
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/billing/simple" element={<p>Simple sale</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillingPage on a plan without the full counter', () => {
  beforeEach(() => {
    advancedPos = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [], meta: null, error: null })),
    );
    useCartStore.getState().clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCartStore.getState().clear();
  });

  it('opens the simple sale screen instead', () => {
    open();
    expect(screen.getByText('Simple sale')).toBeInTheDocument();
  });

  it('still opens a parked bill or an online order, then goes back to the simple one', () => {
    useCartStore.getState().resumeHeld('held-1', [], null, 0);
    open();
    expect(screen.queryByText('Simple sale')).not.toBeInTheDocument();

    act(() => useCartStore.getState().clear());
    expect(screen.getByText('Simple sale')).toBeInTheDocument();
  });

  it('shows the receipt of the bill it was opened for before leaving', async () => {
    useCartStore.getState().resumeHeld('held-1', [LINE], null, 70000);
    open();

    fireEvent.click(screen.getByRole('button', { name: /Complete sale/ }));

    const done = await screen.findByRole('button', { name: 'Receipt: new bill' });
    expect(screen.queryByText('Simple sale')).not.toBeInTheDocument();
    fireEvent.click(done);
    expect(screen.getByText('Simple sale')).toBeInTheDocument();
  });

  it('opens on a plan that has it', () => {
    advancedPos = true;
    open();
    expect(screen.queryByText('Simple sale')).not.toBeInTheDocument();
  });
});
