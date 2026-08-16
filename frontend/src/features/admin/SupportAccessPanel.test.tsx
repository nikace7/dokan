import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportAccessPanel } from '@/features/admin/SupportAccessPanel';
import { buildSupportHandoffUrl } from '@/features/admin/supportHandoff';
import { clearPlatformTokens, setPlatformTokens } from '@/features/admin/tokens';

vi.mock('@/features/admin/supportHandoff', () => ({
  buildSupportHandoffUrl: vi.fn(() => 'https://acme.example/support-login#access=tok-1'),
}));

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TARGETS = [
  { id: 'user-1', phone: '9800000001', full_name: 'Ram Sharma' },
  { id: 'user-2', phone: '9800000002', full_name: 'Sita KC' },
];

const SESSION = {
  id: 'sess-1',
  platform_user: 'pu-1',
  platform_user_name: 'Support Agent',
  tenant: 'tenant-1',
  target_user_id: 'user-1',
  reason: 'Fixing a mispriced item for the shop.',
  scope: 'READ_ONLY',
  started_at: '2026-08-05T00:00:00Z',
  expires_at: '2026-08-05T00:15:00Z',
  ended_at: null,
};

function mockApi() {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/admin/tenants/tenant-1/users')) {
      return Promise.resolve(envelope(TARGETS));
    }
    if (url.endsWith('/v1/admin/tenants/tenant-1/impersonate') && init?.method === 'POST') {
      return Promise.resolve(envelope({ session: SESSION, access: 'tok-1', token_type: 'Bearer' }));
    }
    if (url.endsWith('/v1/admin/impersonations/sess-1/end') && init?.method === 'POST') {
      return Promise.resolve(envelope({ ...SESSION, ended_at: '2026-08-05T00:05:00Z' }));
    }
    return Promise.reject(new Error(`Unexpected request: ${url} ${init?.method ?? 'GET'}`));
  });
}

function renderPanel(role: 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING' = 'SUPER_ADMIN') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SupportAccessPanel tenantId="tenant-1" slug="acme" role={role} />
    </QueryClientProvider>,
  );
}

describe('SupportAccessPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setPlatformTokens({ access: 'platform-access', refresh: 'platform-refresh' });
    mockApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearPlatformTokens();
    vi.mocked(buildSupportHandoffUrl).mockClear();
  });

  it('renders the impersonation targets in the select', async () => {
    renderPanel();

    expect(await screen.findByRole('option', { name: 'Ram Sharma · 9800000001' }))
      .toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sita KC · 9800000002' })).toBeInTheDocument();
  });

  it('defaults the scope to view only', () => {
    renderPanel();

    expect(screen.getByRole('radio', { name: /view only/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /assist — can edit/i })).not.toBeChecked();
  });

  it('blocks submit while the reason is under 20 characters', async () => {
    renderPanel();

    const targetSelect = await screen.findByLabelText('Target user');
    // Wait for the targets query to land before selecting, or the value won't stick.
    await screen.findByRole('option', { name: 'Ram Sharma · 9800000001' });
    fireEvent.change(targetSelect, {
      target: { value: 'user-1' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'too short' } });

    expect(screen.getByText('Reason must be at least 20 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start assist session/i })).toBeDisabled();
  });

  it('starts a session with the expected payload and hands off via supportHandoff', async () => {
    renderPanel();

    const targetSelect = await screen.findByLabelText('Target user');
    // Wait for the targets query to land before selecting, or the value won't stick.
    await screen.findByRole('option', { name: 'Ram Sharma · 9800000001' });
    fireEvent.change(targetSelect, {
      target: { value: 'user-1' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Fixing a mispriced item for the shop.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start assist session/i }));

    await screen.findByText(/session active/i);

    const call = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/impersonate') && init?.method === 'POST',
    );
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      target_user: 'user-1',
      reason: 'Fixing a mispriced item for the shop.',
      scope: 'READ_ONLY',
      duration_minutes: 15,
    });
    expect(buildSupportHandoffUrl).toHaveBeenCalledWith('acme', 'tok-1');

    const openLink = screen.getByRole('link', { name: /open audited tenant session/i });
    expect(openLink).toHaveAttribute('href', 'https://acme.example/support-login#access=tok-1');
  });

  it('ends the active session from the End now button', async () => {
    renderPanel();

    const targetSelect = await screen.findByLabelText('Target user');
    // Wait for the targets query to land before selecting, or the value won't stick.
    await screen.findByRole('option', { name: 'Ram Sharma · 9800000001' });
    fireEvent.change(targetSelect, {
      target: { value: 'user-1' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Fixing a mispriced item for the shop.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start assist session/i }));
    await screen.findByText(/session active/i);

    fireEvent.click(screen.getByRole('button', { name: /end now/i }));

    await waitFor(() => {
      expect(screen.queryByText(/session active/i)).not.toBeInTheDocument();
    });
    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/v1/admin/impersonations/sess-1/end') && init?.method === 'POST',
    );
    expect(call).toBeDefined();
  });

  it('disables the edit scope for non-super-admin roles', () => {
    renderPanel('SUPPORT');

    expect(screen.getByRole('radio', { name: /assist — can edit/i })).toBeDisabled();
    expect(screen.getByText('Super admins only.')).toBeInTheDocument();
  });
});
