import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StaffPage } from '@/features/settings/StaffPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(data: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: { count: data.length, page: 1, total_pages: 1, page_size: 200 },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderStaff() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StaffPage />
    </QueryClientProvider>,
  );
}

const role = {
  id: 'role-1',
  code: 'CASHIER',
  name: 'Cashier',
  name_np: null,
  is_system: true,
  description: null,
  permission_codes: ['sale.create'],
};

describe('StaffPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return envelope({
          id: 'owner-1',
          phone: '9800000000',
          full_name: 'Owner',
          email: null,
          must_change_password: false,
          permissions: ['user.manage'],
        });
      }
      if (url.includes('/v1/roles')) return page([role]);
      if (url.includes('/v1/permissions')) {
        return envelope([
          {
            code: 'sale.create',
            module: 'Sales',
            name: 'Create bills',
            description: null,
            is_sensitive: false,
          },
        ]);
      }
      if (url.endsWith('/v1/users') && init?.method === 'POST') {
        return envelope(
          {
            id: 'staff-2',
            phone: '9800000002',
            email: null,
            full_name: 'New Cashier',
            is_active: true,
            must_change_password: true,
            roles: [
              { id: role.id, code: role.code, name: role.name, branch_id: null, branch_code: null },
            ],
          },
          201,
        );
      }
      if (url.includes('/v1/users/') && init?.method === 'POST') {
        return envelope(
          { id: 'assignment-1', created: true, user: 'staff-1', role: role.code, branch: null },
          201,
        );
      }
      return page([
        {
          id: 'staff-1',
          phone: '9800000001',
          email: null,
          full_name: 'Existing Cashier',
          is_active: true,
          must_change_password: false,
          roles: [],
        },
      ]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('creates staff and assigns an existing role', async () => {
    renderStaff();

    expect(await screen.findByText('Existing Cashier')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Cashier' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9800000002' } });
    fireEvent.change(screen.getByLabelText('Initial password'), {
      target: { value: 'initial123' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: role.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/users$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Staff account created.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Role for Existing Cashier'), {
      target: { value: role.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/staff-1/roles'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
