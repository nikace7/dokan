import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemForm } from '@/features/catalog/ItemForm';
import type { Item } from '@/features/catalog/api';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: null, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ITEM: Item = {
  id: 'item-1',
  code: 'TS',
  name: 'T-Shirt',
  name_np: null,
  category: null,
  brand: null,
  size_chart: null,
  gender: null,
  season: null,
  collection_tag: null,
  hsn_code: null,
  unit: 'PCS',
  is_vat_applicable: false,
  image_url: null,
  min_selling_price: null,
  max_selling_price: null,
  reorder_level: null,
  is_active: true,
};

const IMAGE_URL = '/media/tenants/t1/items/ts.png';

/** Route mock responses; records every request for assertions. */
function installApiMock() {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (
      url.includes('/v1/catalog/categories') ||
      url.includes('/v1/catalog/brands') ||
      url.includes('/v1/catalog/size-charts')
    ) {
      return Promise.resolve(envelope([], 200));
    }
    if (url.endsWith('/api/v1/catalog/items') && method === 'POST') {
      return Promise.resolve(envelope({ ...ITEM, id: 'item-9' }, 201));
    }
    if (url.includes('/image')) {
      if (method === 'POST') {
        const id = url.match(/items\/([^/]+)\/image/)?.[1] ?? ITEM.id;
        return Promise.resolve(envelope({ ...ITEM, id, image_url: IMAGE_URL }));
      }
      if (method === 'DELETE') {
        return Promise.resolve(envelope({ ...ITEM, image_url: null }));
      }
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
}

function renderForm(initial?: Item, onSaved = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ItemForm initial={initial} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}

function pickFile(file: File) {
  fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } });
}

function imageRequests(method: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes('/image') && (init?.method ?? 'GET') === method,
  );
}

describe('ItemForm — item photo', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    installApiMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('uploads immediately on file select in edit mode, as multipart field "image"', async () => {
    renderForm(ITEM);
    const file = new File(['pixels'], 'shirt.png', { type: 'image/png' });
    pickFile(file);

    await waitFor(() => expect(imageRequests('POST')).toHaveLength(1));
    const [url, init] = imageRequests('POST')[0];
    expect(String(url)).toContain(`/v1/catalog/items/${ITEM.id}/image`);
    expect(init?.body).toBeInstanceOf(FormData);
    const body = init?.body as FormData;
    expect((body.get('image') as File).name).toBe('shirt.png');
    expect((body.get('image') as File).type).toBe('image/png');

    // Preview swaps to the uploaded photo returned by the API.
    expect(await screen.findByRole('img', { name: 'T-Shirt' })).toHaveAttribute('src', IMAGE_URL);
  });

  it('rejects a non-image type before any request is made', async () => {
    renderForm(ITEM);
    pickFile(new File(['x'], 'anim.gif', { type: 'image/gif' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only JPG, PNG or WebP photos are allowed.',
    );
    expect(imageRequests('POST')).toHaveLength(0);
  });

  it('rejects a photo over 2 MB before any request is made', async () => {
    renderForm(ITEM);
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    pickFile(big);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The photo must be 2 MB or smaller.',
    );
    expect(imageRequests('POST')).toHaveLength(0);
  });

  it('removes the photo with DELETE and drops the preview', async () => {
    renderForm({ ...ITEM, image_url: IMAGE_URL });
    expect(screen.getByRole('img', { name: 'T-Shirt' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));

    await waitFor(() => expect(imageRequests('DELETE')).toHaveLength(1));
    expect(String(imageRequests('DELETE')[0][0])).toContain(
      `/v1/catalog/items/${ITEM.id}/image`,
    );
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'T-Shirt' })).not.toBeInTheDocument(),
    );
  });

  it('create mode uploads the photo after the item is created', async () => {
    const onSaved = renderForm();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'TS' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'T-Shirt' } });
    pickFile(new File(['pixels'], 'shirt.webp', { type: 'image/webp' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create item' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The item is created first, then the photo is uploaded against its id.
    const createCall = fetchMock.mock.calls.findIndex(
      ([url, init]) => String(url).endsWith('/api/v1/catalog/items') && init?.method === 'POST',
    );
    const imageCall = fetchMock.mock.calls.findIndex(
      ([url, init]) => String(url).includes('/items/item-9/image') && init?.method === 'POST',
    );
    expect(createCall).toBeGreaterThanOrEqual(0);
    expect(imageCall).toBeGreaterThan(createCall);
    const body = fetchMock.mock.calls[imageCall][1]?.body as FormData;
    expect((body.get('image') as File).name).toBe('shirt.webp');
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-9', image_url: IMAGE_URL }),
    );
  });
});
