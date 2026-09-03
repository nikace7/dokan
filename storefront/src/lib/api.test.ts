import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  getMyOrders,
  getProduct,
  getProducts,
  getSite,
  placeOrder,
  requestOtp,
  verifyOtp,
} from './api';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200, meta?: unknown): Response {
  const body: Record<string, unknown> = { data, error: null };
  if (meta !== undefined) body.meta = meta;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('storefront api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('unwraps the site envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({ shop_name: 'Shree Ganesh', template: 'aurora', currency: 'NPR' }),
    );
    const site = await getSite();
    expect(site.shop_name).toBe('Shree Ganesh');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/storefront/site');
  });

  it('throws ApiError with code and message on an error envelope', async () => {
    fetchMock.mockResolvedValueOnce(failure(404, 'TENANT_NOT_FOUND', 'No shop on this domain.'));
    await expect(getSite()).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'TENANT_NOT_FOUND',
      message: 'No shop on this domain.',
    });
  });

  it('is instanceof ApiError so callers can branch on it', async () => {
    fetchMock.mockResolvedValueOnce(failure(500, 'SERVER_ERROR', 'Broken.'));
    await expect(getSite()).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to a generic code when the body is not an envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream error', { status: 502 }));
    await expect(getSite()).rejects.toMatchObject({ status: 502, code: 'REQUEST_FAILED' });
  });

  it('sends category/q/page as query params and returns meta', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope([{ id: 'p1' }], 200, { count: 30, page: 2, total_pages: 3, page_size: 12 }),
    );
    const page = await getProducts({ category: 'cat-1', q: 'shirt', page: 2 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/storefront/products?');
    expect(url).toContain('category=cat-1');
    expect(url).toContain('q=shirt');
    expect(url).toContain('page=2');
    expect(page.data).toHaveLength(1);
    expect(page.meta?.total_pages).toBe(3);
  });

  it('sends featured=1 for the featured rail feed', async () => {
    fetchMock.mockResolvedValueOnce(envelope([], 200, { count: 0, page: 1, total_pages: 0 }));
    await getProducts({ featured: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain('featured=1');
  });

  it('throws on a products error envelope too', async () => {
    fetchMock.mockResolvedValueOnce(failure(400, 'BAD_FILTER', 'Unknown category.'));
    await expect(getProducts({})).rejects.toMatchObject({ code: 'BAD_FILTER' });
  });

  it('loads one product and sends OTP requests as JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(envelope({ id: 'p-1', variants: [] }))
      .mockResolvedValueOnce(envelope({ sent: true }));

    await getProduct('p-1');
    await requestOtp('buyer@example.com');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/storefront/products/p-1');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/storefront/auth/otp');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ email: 'buyer@example.com' }),
    });
  });

  it('verifies OTP and sends customer credentials with checkout', async () => {
    fetchMock
      .mockResolvedValueOnce(
        envelope({
          token: 'shopper-token',
          customer: { email: 'buyer@example.com', full_name: '', phone: '' },
        }),
      )
      .mockResolvedValueOnce(envelope({ number_text: 'ORD-000001' }, 201));

    const session = await verifyOtp('buyer@example.com', '123456');
    await placeOrder(
      {
        customer: { email: 'buyer@example.com', full_name: 'Sita', phone: '9812345678' },
        fulfillment: 'PICKUP',
        payment_method: 'COD',
        address: null,
        note: '',
        items: [{ variant: 'v-1', qty: '1' }],
      },
      session.token,
      'checkout-key',
    );

    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer shopper-token',
        'Idempotency-Key': 'checkout-key',
      }),
    });
  });

  it('uses the shopper token for order history', async () => {
    fetchMock.mockResolvedValueOnce(envelope([]));
    await getMyOrders('shopper-token');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer shopper-token' }),
    });
  });
});
