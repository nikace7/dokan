import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SiteInfo, StoreOrder } from '../lib/api';
import { getMyOrders, getOrder } from '../lib/api';
import { CommerceProvider } from './CommerceProvider';
import { OrdersPage } from './OrdersPage';
import { TrackingPage } from './TrackingPage';

vi.mock('../lib/api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../lib/api')>();
  return { ...original, getMyOrders: vi.fn(), getOrder: vi.fn() };
});

const SITE: SiteInfo = {
  shop_name: 'Himalayan Threads', shop_name_np: null, currency: 'NPR', template: 'aurora',
  contact: { phone: null, address: 'Pokhara' },
  store: { hero_title: '', hero_subtitle: '', announcement: '', offer_text: '', offer_discount_pct: null, offer_ends_at: null, popup: null, banners: [] },
  categories: [],
};

const ORDER: StoreOrder = {
  number_text: 'ORD-000001', status: 'PACKED', fulfillment: 'PICKUP', payment_method: 'COD', payment_status: 'PENDING', address: null, note: '', currency: 'NPR', subtotal: '1500.00', total: '1500.00', offer_text: '', tracking_token: 'track-1', business_date_ad: '2026-09-03', business_date_bs: '2083-05-18', created_at: '2026-09-03T10:00:00Z',
  items: [{ name: 'Linen Shirt', size: 'M', color: 'Blue', unit_price: '1500.00', compare_at: null, qty: '1.000', line_total: '1500.00' }],
};

describe('orders and tracking', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getOrder).mockReset();
    vi.mocked(getMyOrders).mockReset();
  });

  it('shows the public fulfillment progress and ordered lines', async () => {
    vi.mocked(getOrder).mockResolvedValue(ORDER);
    render(<CommerceProvider><TrackingPage site={SITE} trackingToken="track-1" /></CommerceProvider>);
    expect(await screen.findByRole('heading', { name: 'ORD-000001' })).toBeInTheDocument();
    expect(screen.getAllByText('Packed')).toHaveLength(2);
    expect(screen.getByText(/Linen Shirt/)).toBeInTheDocument();
  });

  it('loads order history with the saved shopper token', async () => {
    localStorage.setItem('dokan.storefront.session.v1', JSON.stringify({ token: 'shopper-token', customer: { email: 'buyer@example.com', full_name: 'Sita', phone: '' } }));
    vi.mocked(getMyOrders).mockResolvedValue([ORDER]);
    render(<CommerceProvider><OrdersPage site={SITE} /></CommerceProvider>);
    expect(await screen.findByRole('link', { name: /ORD-000001/ })).toHaveAttribute('href', '/order/track-1');
    expect(getMyOrders).toHaveBeenCalledWith('shopper-token');
  });
});
