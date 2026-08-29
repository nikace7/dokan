import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreSettings } from '@/features/settings/api';
import { StorePromotionsCard } from '@/features/settings/StorePromotionsCard';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

const SETTINGS: StoreSettings = {
  hero_title: '',
  hero_subtitle: '',
  announcement: '',
  offer_text: '',
  offer_discount_pct: null,
  offer_ends_at: null,
  popup_enabled: false,
  popup_title: '',
  popup_text: '',
  popup_cta_text: '',
  popup_cta_link: '',
  banners: [],
  currency: 'NPR',
  shopfront_subdomain: 'demo',
  template: 'bazaar',
  store_url: 'https://demo.shop.dokan.com.np',
  ecommerce_enabled: true,
  active_items_count: 10,
  website_price_count: 4,
};

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderCard(settings: StoreSettings = SETTINGS) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <StorePromotionsCard settings={settings} />
    </QueryClientProvider>,
  );
}

describe('StorePromotionsCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(envelope({ ...SETTINGS, ...body }));
      }
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('hides the popup fields until enabled', () => {
    renderCard();
    expect(screen.queryByLabelText('Popup heading')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show an offer popup to visitors (once per visit)'));
    expect(screen.getByLabelText('Popup heading')).toBeInTheDocument();
  });

  it('saves popup content and banners in one PATCH', async () => {
    renderCard({
      ...SETTINGS,
      popup_enabled: true,
      banners: [{ title: 'Free delivery', text: 'Inside the valley', cta_text: '', cta_link: '' }],
    });

    fireEvent.change(screen.getByLabelText('Popup heading'), { target: { value: 'Namaste!' } });
    fireEvent.change(screen.getByLabelText('Popup message'), {
      target: { value: '20% off your first order' },
    });
    fireEvent.change(screen.getByLabelText('Button text'), { target: { value: 'Shop now' } });
    fireEvent.change(screen.getByLabelText('Button link'), { target: { value: '#shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add banner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.popup_enabled).toBe(true);
    expect(body.popup_title).toBe('Namaste!');
    expect(body.popup_cta_link).toBe('#shop');
    // The untouched empty draft added by "Add banner" is dropped on save.
    expect(body.banners).toEqual([
      { title: 'Free delivery', text: 'Inside the valley', cta_text: '', cta_link: '' },
    ]);
  });

  it('drops empty banner drafts before saving', async () => {
    renderCard({
      ...SETTINGS,
      banners: [{ title: '', text: '', cta_text: '', cta_link: '' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
    });
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(String(init?.body)).banners).toEqual([]);
  });
});
