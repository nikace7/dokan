import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureTogglesPanel } from '@/features/admin/FeatureTogglesPanel';
import { clearPlatformTokens, setPlatformTokens } from '@/features/admin/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ data, meta, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PLAN = {
  id: 'plan-1',
  code: 'basic',
  name: 'Basic',
  price_npr: '0.00',
  billing_cycle: 'monthly',
  limits: {},
  features: { simple_sale: true, advanced_pos: false, sms: true },
  is_active: true,
  sort_order: 0,
};

function mockApi(overrides: { id: string; key: string; value: unknown }[] = []) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/v1/admin/plans')) {
      return Promise.resolve(envelope([PLAN], { count: 1, page: 1, total_pages: 1 }));
    }
    if (url.endsWith('/overrides') && init?.method === 'POST') {
      return Promise.resolve(
        envelope({ id: 'ov-new', ...(JSON.parse(String(init.body)) as object) }, undefined, 201),
      );
    }
    if (url.includes('/overrides/') && init?.method === 'DELETE') {
      return Promise.resolve(envelope({ deleted: 'ov-1' }));
    }
    if (url.endsWith('/overrides')) {
      return Promise.resolve(
        envelope(
          overrides.map((row) => ({ expires_at: null, note: null, ...row })),
          { count: overrides.length, page: 1, total_pages: 1 },
        ),
      );
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

function renderPanel(canWrite = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FeatureTogglesPanel tenantId="tenant-1" planId="plan-1" canWrite={canWrite} />
    </QueryClientProvider>,
  );
}

describe('FeatureTogglesPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setPlatformTokens({ access: 'platform-access', refresh: 'platform-refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearPlatformTokens();
  });

  it('shows plan-default state and source badge for every known feature', async () => {
    mockApi();
    renderPanel();

    expect(await screen.findByText('Advanced POS')).toBeInTheDocument();
    expect(screen.getAllByText('Plan default')).toHaveLength(7);
    // advanced_pos is off in the plan; sms is on.
    expect(screen.getByRole('switch', { name: 'Advanced POS' })).not.toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'SMS receipts' })).toBeChecked(),
    );
  });

  it('writes a features.<name> override when toggled', async () => {
    mockApi();
    renderPanel();

    fireEvent.click(await screen.findByRole('switch', { name: 'Advanced POS' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input).endsWith('/overrides') && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        key: 'features.advanced_pos',
        value: true,
      });
    });
  });

  it('shows the override badge and reset deletes the override', async () => {
    mockApi([{ id: 'ov-1', key: 'features.advanced_pos', value: true }]);
    renderPanel();

    // Effective state comes from the override, not the plan default (false).
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Advanced POS' })).toBeChecked(),
    );
    expect(screen.getByText('Override')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to plan default' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input).includes('/overrides/ov-1') && init?.method === 'DELETE',
      );
      expect(call).toBeDefined();
    });
  });

  it('disables switches without write access', async () => {
    mockApi();
    renderPanel(false);

    expect(await screen.findByRole('switch', { name: 'Advanced POS' })).toBeDisabled();
  });
});
