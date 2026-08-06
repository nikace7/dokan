import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PricingPage } from '@/features/pricing/PricingPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: Array.isArray(data)
        ? { count: data.length, page: 1, page_size: 200, total_pages: 1 }
        : undefined,
      error: null,
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function me(permissions: string[]) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Shop Owner',
    email: null,
    must_change_password: false,
    is_owner: true,
    permissions,
    plan: { code: 'pro', name: 'Pro', features: { custom_rate_types: true } },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PricingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PricingPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('shows selling-price history without exposing write controls to a viewer', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) return Promise.resolve(envelope(me(['pricing.view'])));
      if (url.includes('/v1/pricing/rate-types')) {
        return Promise.resolve(
          envelope([
            {
              id: 'retail-1',
              code: 'retail',
              name: 'Retail',
              name_np: 'खुद्रा',
              is_default: true,
              sort_order: 0,
              default_margin_pct: null,
              required_permission: null,
              is_active: true,
            },
          ]),
        );
      }
      if (url.includes('/v1/pricing/prices')) {
        return Promise.resolve(
          envelope([
            {
              id: 'price-1',
              rate_type: 'retail-1',
              rate_type_code: 'retail',
              scope: 'ITEM',
              variant: null,
              item: 'item-1',
              category: null,
              price: '1200.00',
              effective_from: '2026-08-01',
              effective_to: null,
              created_by: 'user-1',
              created_at: '2026-08-01T00:00:00Z',
            },
          ]),
        );
      }
      if (url.includes('/v1/pricing/changes')) {
        return Promise.resolve(
          envelope([
            {
              id: 'change-1',
              target_type: 'ITEM',
              target_id: 'item-1',
              rate_type: 'retail-1',
              rate_type_code: 'retail',
              old_price: '1100.00',
              new_price: '1200.00',
              changed_by: 'user-1',
              changed_by_name: 'Shop Owner',
              reason: 'Season price update',
              created_at: '2026-08-01T00:00:00Z',
            },
          ]),
        );
      }
      if (url.includes('/v1/catalog/categories') || url.includes('/v1/catalog/items')) {
        return Promise.resolve(envelope([]));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    expect(await screen.findByText('Retail')).toBeInTheDocument();
    // History rows render twice (mobile card + desktop table).
    expect((await screen.findAllByText('Season price update')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'New rate type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save price' })).not.toBeInTheDocument();
  });

  it('creates a rate type and sets a category price for an editor', async () => {
    const rateTypes = [
      {
        id: 'retail-1',
        code: 'retail',
        name: 'Retail',
        name_np: null,
        is_default: true,
        sort_order: 0,
        default_margin_pct: null,
        required_permission: null,
        is_active: true,
      },
    ];
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return envelope(me(['pricing.view', 'pricing.edit', 'pricing.set_bounds']));
      }
      if (url.includes('/v1/permissions')) return envelope([]);
      if (url.includes('/v1/pricing/rate-types') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const created = { id: 'wholesale-1', is_active: true, ...payload };
        rateTypes.push(created as (typeof rateTypes)[number]);
        return envelope(created, 201);
      }
      if (url.includes('/v1/pricing/rate-types')) return envelope(rateTypes);
      if (url.includes('/v1/pricing/prices') && init?.method === 'POST') {
        return envelope({ id: 'price-1', ...(JSON.parse(String(init.body)) as object) }, 201);
      }
      if (url.includes('/v1/pricing/prices') || url.includes('/v1/pricing/changes')) {
        return envelope([]);
      }
      if (url.includes('/v1/catalog/categories')) {
        return envelope([
          {
            id: 'category-1',
            parent: null,
            name: 'Shirts',
            name_np: null,
            size_chart: null,
            default_margin_pct: null,
            min_price_pct: null,
            max_price_pct: null,
            sort_order: 0,
            is_active: true,
          },
        ]);
      }
      if (url.includes('/v1/catalog/variants')) {
        return envelope([
          {
            id: 'variant-1',
            item: 'item-1',
            size: 'M',
            color: 'Blue',
            color_hex: null,
            sku: 'SHIRT-M-BLUE',
            barcode: null,
            mrp: '1200.00',
            min_selling_price: null,
            max_selling_price: null,
            is_active: true,
          },
        ]);
      }
      if (url.includes('/v1/catalog/items')) {
        return envelope([
          {
            id: 'item-1',
            code: 'SHIRT',
            name: 'Oxford Shirt',
            name_np: null,
            category: 'category-1',
            brand: null,
            size_chart: null,
            gender: null,
            season: null,
            collection_tag: null,
            hsn_code: null,
            unit: 'PCS',
            is_vat_applicable: true,
            min_selling_price: null,
            max_selling_price: null,
            reorder_level: null,
            is_active: true,
          },
        ]);
      }
      if (url.includes('/v1/pricing/bounds/item/item-1') && init?.method === 'PATCH') {
        return envelope({
          id: 'item-1',
          min_selling_price: '700.00',
          max_selling_price: '1500.00',
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New rate type' }));
    fireEvent.change(screen.getByLabelText('Rate code'), { target: { value: 'wholesale' } });
    fireEvent.change(screen.getByLabelText('Rate name'), { target: { value: 'Wholesale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate type' }));
    expect(await screen.findByRole('heading', { name: 'Wholesale' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Price scope'), { target: { value: 'CATEGORY' } });
    fireEvent.change(await screen.findByLabelText('Category target'), {
      target: { value: 'category-1' },
    });
    fireEvent.change(screen.getByLabelText('Selling price'), { target: { value: '950.00' } });
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-08-05' },
    });
    fireEvent.change(screen.getByLabelText('Change reason'), {
      target: { value: 'Wholesale launch price' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/pricing/prices'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('category-1'),
        }),
      ),
    );

    fireEvent.change(screen.getByLabelText('Price scope'), { target: { value: 'ITEM' } });
    fireEvent.change(screen.getByLabelText('Item target'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('Minimum selling price'), {
      target: { value: '700.00' },
    });
    fireEvent.change(screen.getByLabelText('Maximum selling price'), {
      target: { value: '1500.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save bounds' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/pricing/bounds/item/item-1'),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );

    fireEvent.change(screen.getByLabelText('Price scope'), { target: { value: 'VARIANT' } });
    fireEvent.change(screen.getByLabelText('Item target'), { target: { value: 'item-1' } });
    await screen.findByRole('option', { name: 'SHIRT-M-BLUE · M / Blue' });
    fireEvent.change(screen.getByLabelText('Variant target'), {
      target: { value: 'variant-1' },
    });
    fireEvent.change(screen.getByLabelText('Selling price'), { target: { value: '975.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/pricing/prices'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('variant-1'),
        }),
      ),
    );
  });
});
