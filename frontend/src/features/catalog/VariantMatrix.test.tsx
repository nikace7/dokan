import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VariantMatrix } from '@/features/catalog/VariantMatrix';
import type { ItemVariant } from '@/features/catalog/api';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EXISTING: ItemVariant[] = [
  {
    id: 'v-existing',
    item: 'item-1',
    size: 'S',
    color: 'Black',
    color_hex: null,
    sku: 'TS-S-BLACK',
    barcode: null,
    mrp: '1500.00',
    min_selling_price: null,
    max_selling_price: null,
    is_active: true,
  },
];

function renderMatrix() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VariantMatrix
        itemId="item-1"
        sizeChartValues={['S', 'M', 'L']}
        existingVariants={EXISTING}
        onCreated={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('VariantMatrix', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('builds the size × colour payload and renders the created/skipped summary', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          created_count: 1,
          skipped_count: 1,
          created: [{ ...EXISTING[0], id: 'v-new', size: 'M', color: 'Black', sku: 'TS-M-BLACK' }],
          skipped: [{ size: 'S', color: 'Black', reason: 'already exists' }],
        },
        201,
      ),
    );

    renderMatrix();

    // Pick sizes S and M, then the Black colour chip.
    fireEvent.click(screen.getByRole('button', { name: 'S' }));
    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Black' }));

    // Grid preview: 2 cells, S/Black flagged as already existing.
    const grid = screen.getByLabelText('Variant grid preview');
    expect(grid).toHaveTextContent('exists');
    expect(screen.getByRole('button', { name: 'Create 2 variants' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 variants' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/catalog/items/item-1/variants/bulk');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ sizes: ['S', 'M'], colors: ['Black'] });

    expect(await screen.findByText(/Created 1 variant, skipped 1/)).toBeInTheDocument();
    expect(screen.getByText(/S \/ Black — already exists/)).toBeInTheDocument();
  });

  it('includes MRP only when entered', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({ created_count: 1, skipped_count: 0, created: [], skipped: [] }, 201),
    );

    renderMatrix();

    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    fireEvent.change(screen.getByLabelText('Custom colour'), { target: { value: 'Maroon' } });
    fireEvent.keyDown(screen.getByLabelText('Custom colour'), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText(/MRP/), { target: { value: '1800.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 variant' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      sizes: ['L'],
      colors: ['Maroon'],
      mrp: '1800.00',
    });
  });

  it('disables creation until at least one size and one colour are picked', () => {
    renderMatrix();
    expect(screen.getByRole('button', { name: 'Create 0 variants' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'S' }));
    expect(screen.getByRole('button', { name: 'Create 0 variants' })).toBeDisabled();
  });
});
