import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpensesPage } from '@/features/expenses/ExpensesPage';
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
      meta: { count: data.length, page: 1, total_pages: 1, page_size: 25 },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderExpenses() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExpensesPage />
    </QueryClientProvider>,
  );
}

const category = { id: 'category-1', name: 'Rent', name_np: null, is_active: true };

const expense = {
  id: 'expense-1',
  branch: null,
  branch_code: null,
  category: category.id,
  category_name: category.name,
  amount: '1500.00',
  payee: 'Landlord',
  note: 'Shop rent',
  business_date_ad: '2026-08-03',
  business_date_bs: '2083-04-18',
  fiscal_year_bs: '2083-84',
  created_by: 'user-1',
  created_by_name: 'Owner',
  created_at: '2026-08-03T00:00:00Z',
};

describe('ExpensesPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/expenses/categories')) return page([category]);
      if (url.includes('/v1/expenses/summary')) {
        return envelope({
          date_from_bs: '2083-04-01',
          date_to_bs: '2083-04-18',
          group_by: 'category',
          groups: [{ key: 'Rent', count: 1, total: '1500.00' }],
          total: '1500.00',
        });
      }
      if (url.includes('/v1/expenses?')) return page([expense]);
      if (url.endsWith('/v1/expenses') && init?.method === 'POST') return envelope(expense, 201);
      throw new Error(`Unhandled request: ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders the current expense list and category summary', async () => {
    renderExpenses();

    expect(await screen.findByText('Shop rent')).toBeInTheDocument();
    expect(screen.getByText('Expenses / खर्च')).toBeInTheDocument();
    expect(screen.getAllByText('रू 1,500.00').length).toBe(2);
    expect(screen.getAllByText('Rent').length).toBe(3);
  });

  it('submits a new expense and reports success', async () => {
    renderExpenses();

    fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: category.id } });
    fireEvent.change(screen.getByLabelText('Amount (NPR)'), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText('Business date (AD)'), {
      target: { value: '2026-08-03' },
    });
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'Electricity board' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/expenses'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Expense saved.')).toBeInTheDocument();
  });

  it('shows the server message when the list fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/v1/expenses/categories')) return page([category]);
      if (url.includes('/v1/expenses/summary')) return envelope({ groups: [], total: '0.00' });
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: 'FORBIDDEN', message: 'Expense access is not allowed.' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderExpenses();

    expect(await screen.findByRole('alert')).toHaveTextContent('Expense access is not allowed.');
  });
});
