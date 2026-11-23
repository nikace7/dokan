import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listCategories, listItems, listVariants } from '@/features/catalog/api';
import { PriceEditor } from '@/features/pricing/PriceEditor';
import { setPriceBounds } from '@/features/pricing/api';

vi.mock('@/features/catalog/api', () => ({
  listCategories: vi.fn(),
  listItems: vi.fn(),
  listVariants: vi.fn(),
}));
vi.mock('@/features/pricing/api', () => ({ setPrice: vi.fn(), setPriceBounds: vi.fn() }));

const page = (data: object[]) =>
  ({ data, meta: { count: data.length, page: 1, total_pages: 1, page_size: 200 } }) as never;

const kurta = (min: string | null, max: string | null) =>
  page([
    { id: 'i-1', code: 'A', name: 'Kurta', min_selling_price: min, max_selling_price: max },
    { id: 'i-2', code: 'B', name: 'Saree', min_selling_price: null, max_selling_price: null },
  ]);

const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const expectBounds = (min: string, max: string) => {
  expect(screen.getByLabelText('Minimum selling price')).toHaveValue(min);
  expect(screen.getByLabelText('Maximum selling price')).toHaveValue(max);
};

describe('PriceEditor guardrails', () => {
  beforeEach(async () => {
    vi.mocked(listCategories).mockResolvedValue(page([]));
    vi.mocked(listItems).mockReset().mockResolvedValue(kurta('10.00', '20.00'));
    vi.mocked(listVariants).mockResolvedValue(
      page([
        {
          id: 'v-1',
          sku: 'S1',
          size: 'M',
          color: 'Red',
          min_selling_price: '11.00',
          max_selling_price: null,
        },
      ]),
    );
    vi.mocked(setPriceBounds)
      .mockReset()
      .mockResolvedValue({ id: 'i-1', min_selling_price: '12.00', max_selling_price: '20.00' });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PriceEditor rates={[]} canSetBounds />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: 'A · Kurta' });
  });

  it('saving only a new minimum keeps the current maximum', async () => {
    pick('Price scope', 'ITEM');
    pick('Item target', 'i-1');
    expectBounds('10.00', '20.00');

    vi.mocked(listItems).mockResolvedValue(kurta('12.00', '20.00'));
    pick('Minimum selling price', '12');
    fireEvent.click(screen.getByRole('button', { name: 'Save bounds' }));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(setPriceBounds).toHaveBeenCalledWith('item', 'i-1', {
      min_selling_price: '12',
      max_selling_price: '20.00',
    });

    // Picking the item again shows the saved limits, not the old ones.
    pick('Item target', 'i-2');
    expectBounds('', '');
    pick('Item target', 'i-1');
    await waitFor(() => expectBounds('12.00', '20.00'));
  });

  it('never carries the limits of one target over to another', async () => {
    pick('Item target', 'i-1');
    expectBounds('', '');
    await screen.findByRole('option', { name: 'S1 · M / Red' });
    pick('Variant target', 'v-1');
    expectBounds('11.00', '');
    pick('Item target', 'i-2');
    expectBounds('', '');
  });
});
