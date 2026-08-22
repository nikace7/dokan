import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VariantPicker } from '@/features/catalog/VariantPicker';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: object, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: meta ?? null, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PAGE_META = { count: 2, page: 1, total_pages: 1, page_size: 10 };

const ITEM_PHOTO = {
  id: 'item-1',
  code: 'TS',
  name: 'T-Shirt',
  name_np: 'टीसर्ट',
  category: null,
  brand: null,
  size_chart: null,
  gender: 'U',
  season: null,
  collection_tag: null,
  hsn_code: null,
  unit: 'PCS',
  is_vat_applicable: false,
  image_url: '/media/tenants/t1/items/ts.png',
  variants_count: 2,
  mrp_min: '1000.00',
  mrp_max: '1000.00',
  min_selling_price: null,
  max_selling_price: null,
  reorder_level: null,
  is_active: true,
};

const ITEM_NO_PHOTO = {
  ...ITEM_PHOTO,
  id: 'item-2',
  code: 'JNS',
  name: 'Jeans',
  name_np: 'जिन्स',
  image_url: null,
};

const VARIANTS = [
  {
    id: 'variant-1',
    item: 'item-1',
    size: 'M',
    color: 'Black',
    color_hex: null,
    sku: 'TS-M-BLK',
    barcode: null,
    mrp: '1000.00',
    min_selling_price: null,
    max_selling_price: null,
    is_active: true,
  },
  {
    id: 'variant-2',
    item: 'item-1',
    size: 'L',
    color: 'White',
    color_hex: null,
    sku: 'TS-L-WHT',
    barcode: null,
    mrp: '1000.00',
    min_selling_price: null,
    max_selling_price: null,
    is_active: true,
  },
];

function renderPicker(onPick: (variant: PickedVariant) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VariantPicker onPick={onPick} />
    </QueryClientProvider>,
  );
}

function mockCatalog() {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/v1/catalog/items')) return envelope([ITEM_PHOTO, ITEM_NO_PHOTO], PAGE_META);
    if (url.includes('/v1/catalog/variants'))
      return envelope(VARIANTS, { ...PAGE_META, count: VARIANTS.length });
    throw new Error(`Unhandled request: ${url}`);
  });
}

describe('VariantPicker', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    mockCatalog();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders item photos in search results, with a placeholder tile when null', async () => {
    renderPicker(vi.fn());
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'sh' } });

    const photo = await screen.findByRole('img', { name: 'T-Shirt' });
    expect(photo).toHaveAttribute('src', '/media/tenants/t1/items/ts.png');
    expect(photo).toHaveAttribute('loading', 'lazy');

    // No photo for Jeans: the row shows the placeholder tile instead of an img.
    const jeansRow = screen.getByRole('button', { name: /Jeans/ });
    expect(jeansRow.querySelector('img')).toBeNull();
    expect(jeansRow.querySelector('svg.lucide-image')).not.toBeNull();
  });

  it('shows the photo beside the selected item header and picks a variant', async () => {
    const onPick = vi.fn();
    renderPicker(onPick);
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'sh' } });

    fireEvent.click(await screen.findByRole('button', { name: /T-Shirt/ }));

    const headerPhoto = await screen.findByRole('img', { name: 'T-Shirt' });
    expect(headerPhoto).toHaveAttribute('src', '/media/tenants/t1/items/ts.png');

    fireEvent.click(await screen.findByRole('button', { name: /M \/ Black/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'variant-1', sku: 'TS-M-BLK', itemName: 'T-Shirt' }),
    );
  });
});
