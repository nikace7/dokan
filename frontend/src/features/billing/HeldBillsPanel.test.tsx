import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSale, holdSale, listHeldBills } from '@/features/billing/api';
import { HeldBillsPanel } from '@/features/billing/HeldBillsPanel';
import { ApiError } from '@/lib/api/client';
import { useCartStore } from '@/stores/cartStore';

vi.mock('@/features/billing/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSale: vi.fn(),
  holdSale: vi.fn(),
  listHeldBills: vi.fn(),
}));
vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({ branchId: 'branch-1', rateTypeId: 'rate-1' }),
}));

const HELD = {
  id: 'held-1',
  customer: null,
  customer_name: null,
  total: '840.00',
  items: [
    {
      variant: 'v-9',
      variant_sku: 'SKU-9',
      item_name: 'Kurta',
      qty: '1.000',
      unit_price: '900.00',
      discount: '60.00',
    },
  ],
} as never;

const cart = () => useCartStore.getState();
const click = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

function startBill() {
  cart().addLine({
    variantId: 'v-1',
    sku: 'SKU-1',
    label: 'T-Shirt',
    quantity: 2,
    unitPricePaisa: 100_000,
    discountPaisa: 0,
  });
}

async function resume() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <HeldBillsPanel />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /resume/i }));
}

describe('resuming a held bill', () => {
  beforeEach(() => {
    cart().clear();
    vi.mocked(listHeldBills).mockResolvedValue([HELD]);
    vi.mocked(getSale).mockReset().mockResolvedValue(HELD);
    vi.mocked(holdSale).mockReset().mockResolvedValue(HELD);
  });

  it('opens at once when no bill is in progress', async () => {
    await resume();
    await waitFor(() => expect(cart().heldSaleId).toBe('held-1'));
    expect(cart().heldTotalPaisa).toBe(84_000);
  });

  it('asks first, and cancelling keeps the current bill', async () => {
    startBill();
    await resume();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(getSale).not.toHaveBeenCalled();

    click(/cancel/i);
    expect(cart().lines[0].sku).toBe('SKU-1');
    expect(cart().heldSaleId).toBeNull();
  });

  it('parks the current bill, then opens the other one', async () => {
    startBill();
    await resume();
    click(/park it/i);

    await waitFor(() => expect(cart().heldSaleId).toBe('held-1'));
    expect(vi.mocked(holdSale).mock.calls[0][0]).toMatchObject({
      branch: 'branch-1',
      rate_type: 'rate-1',
      lines: [{ variant: 'v-1', qty: '2', discount: '0.00' }],
    });
  });

  it('keeps the current bill when parking it fails', async () => {
    vi.mocked(holdSale).mockRejectedValue(
      new ApiError(409, { code: 'STOCK_INSUFFICIENT', message: 'Not enough stock.' }),
    );
    startBill();
    await resume();
    click(/park it/i);

    expect(await screen.findByText('Not enough stock.')).toBeInTheDocument();
    expect(cart().lines[0].sku).toBe('SKU-1');
    expect(getSale).not.toHaveBeenCalled();
  });

  it('will not park a bill whose discount is wrong', async () => {
    startBill();
    cart().setDiscount('v-1', 'abc');
    await resume();
    click(/park it/i);
    expect(await screen.findByText(/fix the discount/i)).toBeInTheDocument();
    expect(holdSale).not.toHaveBeenCalled();
  });

  it('discards the current bill only when told to', async () => {
    startBill();
    await resume();
    click(/discard it/i);
    await waitFor(() => expect(cart().heldSaleId).toBe('held-1'));
    expect(holdSale).not.toHaveBeenCalled();
  });

  it('switches between held bills without asking, since both stay parked', async () => {
    startBill();
    cart().resumeHeld('held-2', cart().lines, null, 200_000);
    await resume();
    await waitFor(() => expect(cart().heldSaleId).toBe('held-1'));
  });

  it('never replaces a bill the server has not confirmed', async () => {
    startBill();
    cart().setUnconfirmedSale({ payload: {} as never, key: 'k' });
    await resume();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not confirmed/i);
    expect(getSale).not.toHaveBeenCalled();
    expect(cart().unconfirmedSale).not.toBeNull();
  });

  it('says so when the held bill cannot be opened', async () => {
    vi.mocked(getSale).mockRejectedValue(new TypeError('Failed to fetch'));
    await resume();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not open/i);
  });

  it('asks again when an item is scanned while the held bill is loading', async () => {
    let answer: (sale: never) => void = () => undefined;
    vi.mocked(getSale).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await resume();
    await waitFor(() => expect(getSale).toHaveBeenCalled());
    startBill();
    answer(HELD);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(cart().lines[0].sku).toBe('SKU-1');
  });
});
