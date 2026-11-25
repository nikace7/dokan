import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

import { fetchCollectionsByTender, fetchDashboard } from '@/features/dashboard/api';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

const MAIN = { id: 'b1', name: 'Main' };
const BAZAR = { id: 'b2', name: 'New Bazar' };
let branches = [MAIN];

vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({ branches, branchId: 'b1' }),
}));
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    user: { full_name: 'Ram', permissions: ['report.sales'], plan: { features: {} } },
  }),
}));
vi.mock('@/features/dashboard/api', async (original) => ({
  ...(await original<typeof import('@/features/dashboard/api')>()),
  fetchDashboard: vi.fn(),
  fetchCollectionsByTender: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchDashboard).mockResolvedValue({
    shop_name: 'Shree Ganesh',
    business_date_bs: '2083-04-20',
  } as never);
  vi.mocked(fetchCollectionsByTender).mockResolvedValue({ methods: [], total: '0.00' } as never);
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('says which branches each number covers when the shop has several', async () => {
  branches = [MAIN, BAZAR];
  renderPage();

  // The summary is for the whole shop; only the collections follow the branch.
  expect(await screen.findByText(/Shree Ganesh/)).toHaveTextContent(
    'Shree Ganesh · All branches · BS 2083-04-20',
  );
  expect(screen.getByText(/This BS month/)).toHaveTextContent(/^Main · /);
});

it('names the branch when the shop has one', async () => {
  branches = [MAIN];
  renderPage();

  expect(await screen.findByText(/Shree Ganesh/)).toHaveTextContent(
    'Shree Ganesh · Main · BS 2083-04-20',
  );
});
