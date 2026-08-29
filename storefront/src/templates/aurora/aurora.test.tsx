import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SiteInfo } from '../../lib/api';
import { AuroraTemplate } from './AuroraTemplate';

const fetchMock = vi.fn<typeof fetch>();

const SITE: SiteInfo = {
  shop_name: 'Apsara Boutique',
  shop_name_np: 'अप्सरा',
  currency: 'NPR',
  template: 'aurora',
  contact: { phone: '01-5550000', address: 'New Road, Kathmandu' },
  categories: [
    { id: 'cat-1', name: 'Shirts', name_np: null, product_count: 2 },
    { id: 'cat-2', name: 'Jeans', name_np: null, product_count: 1 },
  ],
};

const PRODUCT = {
  id: 'p-1',
  code: 'SH-001',
  name: 'Linen Shirt',
  name_np: null,
  image: null,
  category: 'Shirts',
  brand: 'Apsara',
  price_min: '1800.00',
  price_max: '2200.00',
  in_stock: true,
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

describe('AuroraTemplate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    mockProducts();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders the shop name and a fetched product', async () => {
    render(<AuroraTemplate site={SITE} />);

    expect(screen.getAllByText('Apsara Boutique').length).toBeGreaterThan(0);
    expect(screen.getByText('अप्सरा')).toBeInTheDocument();

    expect(await screen.findByText('Linen Shirt')).toBeInTheDocument();
    expect(screen.getByText('Rs 1,800 – 2,200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  });
});
