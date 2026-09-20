import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDetail, SiteInfo, StoreOrder } from '../lib/api';
import { getProduct, placeOrder, requestOtp, verifyOtp } from '../lib/api';
import { CheckoutPage } from './CheckoutPage';
import { CommerceProvider } from './CommerceProvider';
import { ProductPage } from './ProductPage';

vi.mock('../lib/api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../lib/api')>();
  return {
    ...original,
    getProduct: vi.fn(),
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    placeOrder: vi.fn(),
  };
});

const SITE: SiteInfo = {
  shop_name: 'Himalayan Threads',
  shop_name_np: 'हिमालयन थ्रेड्स',
  currency: 'NPR',
  template: 'aurora',
  contact: { phone: '9800000000', address: 'Lakeside, Pokhara' },
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
  categories: [],
};

const PRODUCT: ProductDetail = {
  id: 'product-1',
  code: 'LIN-1',
  name: 'Linen Shirt',
  name_np: null,
  image: null,
  category: 'Shirts',
  brand: 'Dokan',
  website_price: '1500.00',
  website_compare_at: null,
  offer_pct: null,
  variants: [
    {
      id: 'variant-1',
      size: 'M',
      color: 'Blue',
      sku: 'LIN-M-BLU',
      in_stock: true,
      price: '1500.00',
      compare_at: null,
    },
  ],
};

const ORDER: StoreOrder = {
  number_text: 'ORD-000001',
  status: 'PLACED',
  fulfillment: 'PICKUP',
  payment_method: 'COD',
  payment_status: 'PENDING',
  address: null,
  note: '',
  currency: 'NPR',
  subtotal: '1500.00',
  total: '1500.00',
  offer_text: '',
  tracking_token: 'track-1',
  business_date_ad: '2026-09-03',
  business_date_bs: '2083-05-18',
  created_at: '2026-09-03T10:00:00Z',
  items: [
    {
      name: 'Linen Shirt',
      size: 'M',
      color: 'Blue',
      unit_price: '1500.00',
      compare_at: null,
      qty: '1.000',
      line_total: '1500.00',
    },
  ],
};

describe('shopper commerce flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getProduct).mockReset();
    vi.mocked(requestOtp).mockReset();
    vi.mocked(verifyOtp).mockReset();
    vi.mocked(placeOrder).mockReset();
  });

  it('selects an in-stock option and adds it to the persisted bag', async () => {
    vi.mocked(getProduct).mockResolvedValue(PRODUCT);
    render(
      <CommerceProvider>
        <ProductPage site={SITE} productId="product-1" />
      </CommerceProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'M / Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to bag' }));

    expect(screen.getByRole('link', { name: 'View bag (1)' })).toHaveAttribute('href', '/cart');
  });

  it('logs in by email code and places a COD pickup order', async () => {
    localStorage.setItem(
      'dokan.storefront.cart.v1',
      JSON.stringify([
        {
          variantId: 'variant-1',
          productId: 'product-1',
          name: 'Linen Shirt',
          image: null,
          size: 'M',
          color: 'Blue',
          unitPrice: '1500.00',
          compareAt: null,
          qty: 1,
        },
      ]),
    );
    vi.mocked(requestOtp).mockResolvedValue({ sent: true });
    vi.mocked(verifyOtp).mockResolvedValue({
      token: 'shopper-token',
      customer: { email: 'buyer@example.com', full_name: '', phone: '' },
    });
    vi.mocked(placeOrder).mockResolvedValue(ORDER);
    const navigate = vi.fn();

    render(
      <CommerceProvider>
        <CheckoutPage site={SITE} navigate={navigate} />
      </CommerceProvider>,
    );

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'buyer@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send login code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));

    fireEvent.change(await screen.findByLabelText('Full name'), {
      target: { value: 'Sita Buyer' },
    });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '9812345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Place COD order' }));

    await waitFor(() => expect(placeOrder).toHaveBeenCalledOnce());
    expect(vi.mocked(placeOrder).mock.calls[0][0]).toMatchObject({
      customer: {
        email: 'buyer@example.com',
        full_name: 'Sita Buyer',
        phone: '9812345678',
      },
      fulfillment: 'PICKUP',
      payment_method: 'COD',
      items: [{ variant: 'variant-1', qty: '1' }],
    });
    expect(navigate).toHaveBeenCalledWith('/order/track-1');
  });
});
