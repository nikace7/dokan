import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, getProducts, getSite } from './api';

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
});
