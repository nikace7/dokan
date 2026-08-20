import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listBrands,
  listCategories,
  listSizeCharts,
  quickCreateProduct,
  uploadItemImage,
} from '@/features/catalog/api';
import type { QuickCreateProductPayload } from '@/features/catalog/api';
import { QuickAddProductPage } from '@/features/catalog/QuickAddProductPage';
import { ApiError } from '@/lib/api/client';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

vi.mock('@/features/catalog/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/catalog/api')>();
  return {
    ...actual,
    listCategories: vi.fn(),
    listBrands: vi.fn(),
    listSizeCharts: vi.fn(),
    createCategory: vi.fn(),
    createBrand: vi.fn(),
    createSizeChart: vi.fn(),
    quickCreateProduct: vi.fn(),
    uploadItemImage: vi.fn(),
  };
});

vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({
    branches: [{ id: 'branch-1', code: 'MAIN', name: 'Main Branch' }],
    branchId: 'branch-1',
    isReady: true,
    isLoading: false,
    error: null,
  }),
}));

const quickCreateMock = vi.mocked(quickCreateProduct);
const uploadImageMock = vi.mocked(uploadItemImage);

const EMPTY_PAGE = { data: [], meta: { count: 0, page: 1, total_pages: 1, page_size: 200 } };

const RESULT = {
  item: { id: 'item-9', code: '0001', name: 'Uniqlo Jacket' },
  variants: [],
  variants_created: 2,
  stock_movements: 1,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/catalog/items/new']}>
        <Routes>
          <Route path="/catalog/items/new" element={<QuickAddProductPage />} />
          <Route path="/catalog/items/:id" element={<p>Product detail</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Minimum fill: code, name, one custom size, one common colour. */
function fillBasics() {
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: '0001' } });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Uniqlo Jacket' } });
  const sizeInput = screen.getByLabelText('Custom size');
  fireEvent.change(sizeInput, { target: { value: 'S' } });
  fireEvent.keyDown(sizeInput, { key: 'Enter' });
  fireEvent.change(sizeInput, { target: { value: 'M' } });
  fireEvent.keyDown(sizeInput, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: '+ Black' }));
}

function submittedPayload(): QuickCreateProductPayload {
  expect(quickCreateMock).toHaveBeenCalledTimes(1);
  return quickCreateMock.mock.calls[0][0];
}

describe('QuickAddProductPage', () => {
  beforeEach(() => {
    setTokens({ access: 'a', refresh: 'r' });
    vi.mocked(listCategories).mockResolvedValue(EMPTY_PAGE);
    vi.mocked(listBrands).mockResolvedValue(EMPTY_PAGE);
    vi.mocked(listSizeCharts).mockResolvedValue(EMPTY_PAGE);
    quickCreateMock.mockResolvedValue(RESULT as never);
    uploadImageMock.mockResolvedValue(RESULT.item as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearTokens();
  });

  it('submits the full payload including stock when a quantity is entered', async () => {
    renderPage();
    fillBasics();
    fireEvent.change(screen.getByLabelText('Quantity for S / Black'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Unit cost (रू)'), { target: { value: '700' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));

    await waitFor(() => expect(quickCreateMock).toHaveBeenCalledTimes(1));
    expect(submittedPayload()).toEqual({
      code: '0001',
      name: 'Uniqlo Jacket',
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
      min_selling_price: null,
      max_selling_price: null,
      reorder_level: null,
      sizes: ['S', 'M'],
      colors: ['Black'],
      mrp: null,
      stock: {
        branch: 'branch-1',
        unit_cost: '700',
        note: '',
        quantities: { 'S::Black': '10' },
      },
    });

    // Success panel with response counts, then "View product" navigates away.
    expect(await screen.findByText('Product "Uniqlo Jacket" added.')).toBeInTheDocument();
    expect(screen.getByText('Created 2 variants · 1 stock entry posted')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View product' }));
    expect(await screen.findByText('Product detail')).toBeInTheDocument();
  });

  it('omits stock from the payload when no quantity is entered', async () => {
    quickCreateMock.mockResolvedValue({ ...RESULT, stock_movements: 0 } as never);
    renderPage();
    fillBasics();

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));

    await waitFor(() => expect(quickCreateMock).toHaveBeenCalledTimes(1));
    expect(submittedPayload()).not.toHaveProperty('stock');
  });

  it('requires a unit cost before submitting when quantities are set', async () => {
    renderPage();
    fillBasics();
    fireEvent.change(screen.getByLabelText('Quantity for S / Black'), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unit cost is required when you enter opening quantities.',
    );
    expect(quickCreateMock).not.toHaveBeenCalled();
  });

  it('shows the API error message when the create fails', async () => {
    quickCreateMock.mockRejectedValue(
      new ApiError(400, { code: 'VALIDATION', message: 'Code 0001 already exists.' }),
    );
    renderPage();
    fillBasics();

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Code 0001 already exists.');
  });
});
