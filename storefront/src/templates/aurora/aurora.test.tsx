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
  website_price: null,
  website_compare_at: null,
  offer_pct: null,
  featured: false,
  in_stock: true,
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

  it('renders tenant-controlled content, offer, and a discounted website price', async () => {
    const site: SiteInfo = {
      ...SITE,
      store: {
        ...SITE.store,
        hero_title: 'Winter Edit',
        hero_subtitle: 'Warm layers, honest prices.',
        announcement: 'Free delivery inside the valley',
        offer_text: 'Dashain Sale',
        offer_discount_pct: '25.00',
      },
    };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/v1/storefront/products')) {
        return Promise.resolve(
          productsResponse(
            url.includes('featured=1')
              ? []
              : [{ ...PRODUCT, website_price: '1500.00', website_compare_at: '2000.00' }],
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<AuroraTemplate site={site} />);

    expect(screen.getByText('Winter Edit')).toBeInTheDocument();
    expect(screen.getByText('Warm layers, honest prices.')).toBeInTheDocument();
    expect(screen.getByText('Free delivery inside the valley')).toBeInTheDocument();
    expect(screen.getByText('Dashain Sale · 25% off')).toBeInTheDocument();
    // Website price wins over the range; the original is struck through.
    expect(await screen.findByText('Rs 1,500')).toBeInTheDocument();
    expect(screen.getByText('Rs 2,000')).toBeInTheDocument();
    expect(screen.queryByText('Rs 1,800 – 2,200')).not.toBeInTheDocument();
  });

  it('renders banners, a featured rail, and discount badges', async () => {
    const featuredProduct = {
      ...PRODUCT,
      id: 'p-2',
      name: 'Handloom Scarf',
      featured: true,
      website_price: '765.00',
      website_compare_at: '900.00',
      offer_pct: '15.00',
    };
    const site: SiteInfo = {
      ...SITE,
      store: {
        ...SITE.store,
        banners: [
          { title: 'Free delivery', text: 'Inside the valley', cta_text: '', cta_link: '' },
        ],
      },
    };
    mockProducts([featuredProduct]);

    render(<AuroraTemplate site={site} />);

    expect(screen.getByText('Free delivery')).toBeInTheDocument();
    expect(screen.getByText('Inside the valley')).toBeInTheDocument();
    expect(await screen.findByText('Handloom Scarf')).toBeInTheDocument();
    expect(screen.getByText('−15%')).toBeInTheDocument();
  });

  it('appends the countdown to a scheduled offer', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Local-date ISO (offerCountdown compares calendar dates, not instants).
    const ends = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const site: SiteInfo = {
      ...SITE,
      store: {
        ...SITE.store,
        offer_text: 'Flash Sale',
        offer_discount_pct: '10.00',
        offer_ends_at: ends,
      },
    };

    render(<AuroraTemplate site={site} />);

    expect(screen.getByText('Flash Sale · 10% off · Ends in 1 day')).toBeInTheDocument();
  });
});
