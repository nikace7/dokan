import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanInput } from '@/features/billing/ScanInput';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { useCartStore } from '@/stores/cartStore';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VARIANT = {
  id: 'var-1',
  sku: 'TS-BLK-M',
  barcode: '8901234567890',
  size: 'M',
  color: 'Black',
  color_hex: '#000000',
  mrp: '1500.00',
  image_url: '/media/tenants/t1/items/tshirt.png',
  is_active: true,
  item__name: 'T-Shirt',
  item__name_np: 'टीसर्ट',
  item__code: 'TS',
};

function scan(code: string): HTMLElement {
  const input = screen.getByLabelText(/scan barcode or type sku/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  return input;
}

describe('ScanInput', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
    useCartStore.getState().clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    useCartStore.getState().clear();
  });

  it('shows the last-scanned card with photo, price, and running quantity', async () => {
    // Fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(envelope(VARIANT)));
    render(<ScanInput />);

    // Hidden until the first successful scan of the session.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const input = scan('8901234567890');
    const card = await screen.findByRole('status', { name: /last scanned item/i });

    expect(within(card).getByRole('img', { name: 'T-Shirt — M / Black' })).toHaveAttribute(
      'src',
      '/media/tenants/t1/items/tshirt.png',
    );
    expect(within(card).getByText('T-Shirt — M / Black')).toBeInTheDocument();
    expect(within(card).getByText('रू 1,500.00')).toBeInTheDocument();
    expect(within(card).getByText('In cart: 1')).toBeInTheDocument();

    // The card never steals focus — the scanner keeps typing into the input.
    expect(document.activeElement).toBe(input);

    // Rescanning the same variant bumps the running quantity.
    scan('8901234567890');
    expect(
      await within(screen.getByRole('status', { name: /last scanned item/i })).findByText(
        'In cart: 2',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the card hidden after a failed lookup and shows the error', async () => {
    // 404 on both the barcode attempt and the SKU fallback.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'No.' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(<ScanInput />);

    scan('0000000000000');

    expect(await screen.findByRole('alert')).toHaveTextContent('No item matches "0000000000000".');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('falls back to the placeholder tile when the variant has no photo', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(envelope({ ...VARIANT, image_url: null })));
    render(<ScanInput />);

    scan('8901234567890');
    const card = await screen.findByRole('status', { name: /last scanned item/i });

    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
    expect(within(card).getByText('In cart: 1')).toBeInTheDocument();
  });
});
