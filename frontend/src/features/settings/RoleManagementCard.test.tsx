import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleManagementCard } from '@/features/settings/RoleManagementCard';
import type { Role } from '@/features/settings/api';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderCard(roles: Role[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RoleManagementCard roles={roles} />
    </QueryClientProvider>,
  );
}

const customRole: Role = {
  id: 'role-1',
  code: 'CASHIER',
  name: 'Cashier',
  name_np: null,
  is_system: false,
  description: null,
  permission_codes: [],
};

describe('RoleManagementCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
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
      if (init?.method === 'POST') return envelope({ ...customRole, code: 'SUPERVISOR' }, 201);
      if (init?.method === 'PATCH') return envelope({ ...customRole, name: 'Floor Supervisor' });
      return envelope({ deleted: customRole.id });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('creates and edits a custom role', async () => {
    renderCard([]);

    expect(await screen.findByText('Create bills')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role code'), { target: { value: 'SUPERVISOR' } });
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Supervisor' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/roles$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Role created.')).toBeInTheDocument();

    cleanup();
    renderCard([customRole]);
    expect(await screen.findByText('Cashier', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'Floor Supervisor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update role' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/roles/role-1'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });
});
