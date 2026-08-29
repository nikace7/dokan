import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SiteInfo } from '../../lib/api';
import { BazaarTemplate } from './BazaarTemplate';

const fetchMock = vi.fn<typeof fetch>();

const SITE: SiteInfo = {
  shop_name: 'City Bazaar',
  shop_name_np: null,
  currency: 'INR',
  template: 'bazaar',
  contact: { phone: '9800000000', address: 'Main Bazaar, Pokhara' },
  categories: [{ id: 'cat-1', name: 'Jackets', name_np: null, product_count: 1 }],
};

const PRODUCT = {
  id: 'p-9',
  code: 'JK-009',
  name: 'Denim Jacket',
  name_np: null,
  image: '/media/tenants/t1/items/jacket.png',
  category: 'Jackets',
  brand: 'Levis',
  price_min: null,
  price_max: null,
  in_stock: false,
};

function mockProducts() {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/v1/storefront/products')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [PRODUCT],
            meta: { count: 1, page: 1, total_pages: 1, page_size: 12 },
            error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

describe('BazaarTemplate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    mockProducts();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders the shop name and a fetched out-of-stock product', async () => {
    render(<BazaarTemplate site={SITE} />);

    expect(screen.getAllByText('City Bazaar').length).toBeGreaterThan(0);

    expect(await screen.findByText('Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText('Price on request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jackets/ })).toBeInTheDocument();
  });
});
