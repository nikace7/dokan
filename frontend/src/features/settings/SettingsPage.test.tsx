import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '@/features/settings/SettingsPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const settings = {
  id: 'tenant-1',
  slug: 'demo',
  name: 'Demo Store',
  name_np: null,
  legal_name: null,
  pan_vat_no: null,
  vat_registered: false,
  timezone: 'Asia/Kathmandu',
  calendar_pref: 'BS',
  locale: 'np',
  status: 'ACTIVE',
  plan_code: 'demo',
};

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes('/v1/auth/me')) {
        return envelope({
          id: 'user-1',
          phone: '9800000000',
          full_name: 'Demo Owner',
          email: null,
          must_change_password: false,
          is_owner: true,
          permissions: ['settings.manage'],
        });
      }
      if (init?.method === 'PATCH') {
        return envelope({ ...settings, name: 'Updated Shop' });
      }
      return envelope(settings);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('loads and saves the shop profile', async () => {
    renderSettings();

    expect(await screen.findByDisplayValue('Demo Store')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Shop name'), { target: { value: 'Updated Shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/settings'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(await screen.findByText('Shop settings saved.')).toBeInTheDocument();
  });
});
