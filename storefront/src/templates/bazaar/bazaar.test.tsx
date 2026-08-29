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
  store: {
    hero_title: '',
    hero_subtitle: '',
    announcement: '',
    offer_text: '',
    offer_discount_pct: null,
    offer_ends_at: null,
    popup: null,
    banners: [],
  },
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
  website_price: null,
  website_compare_at: null,
  offer_pct: null,
  featured: false,
  in_stock: false,
};

function productsResponse(data: unknown[]) {
  return new Response(
    JSON.stringify({
      data,
      meta: { count: data.length, page: 1, total_pages: 1, page_size: 12 },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockProducts(featured: unknown[] = []) {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/v1/storefront/products')) {
      // The featured rail fetches separately — empty unless the test opts in.
      return Promise.resolve(productsResponse(url.includes('featured=1') ? featured : [PRODUCT]));
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

  it('renders tenant-controlled hero, offer, and a website price', async () => {
    const site: SiteInfo = {
      ...SITE,
      store: {
        ...SITE.store,
        hero_title: 'Big Winter Drop',
        offer_text: 'Clearance',
        offer_discount_pct: '10.00',
      },
    };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/v1/storefront/products')) {
        return Promise.resolve(
          productsResponse(
            url.includes('featured=1')
              ? []
              : [{ ...PRODUCT, website_price: '900.00', website_compare_at: null }],
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<BazaarTemplate site={site} />);

    expect(screen.getByText('Big Winter Drop')).toBeInTheDocument();
    expect(screen.getByText('Clearance · 10% off')).toBeInTheDocument();
    expect(await screen.findByText('₹900')).toBeInTheDocument();
    expect(screen.queryByText('Price on request')).not.toBeInTheDocument();
  });

  it('renders linked banners and the featured rail with a badge', async () => {
    const featuredProduct = {
      ...PRODUCT,
      id: 'p-10',
      name: 'Pashmina Shawl',
      featured: true,
      in_stock: true,
      website_price: '2125.00',
      website_compare_at: '2500.00',
      offer_pct: '15.00',
    };
    const site: SiteInfo = {
      ...SITE,
      store: {
        ...SITE.store,
        banners: [
          {
            title: 'New arrivals',
            text: 'Fresh from the loom',
            cta_text: 'Shop the drop',
            cta_link: '#shop',
          },
        ],
      },
    };
    mockProducts([featuredProduct]);

    render(<BazaarTemplate site={site} />);

    expect(screen.getByRole('link', { name: /New arrivals/ })).toHaveAttribute('href', '#shop');
    expect(await screen.findByText('Pashmina Shawl')).toBeInTheDocument();
    expect(screen.getByText('−15%')).toBeInTheDocument();
  });
});
