import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickedVariant } from '@/features/catalog/VariantPicker';
import {
  draftLineTotalPaisa,
  PurchaseInvoiceForm,
} from '@/features/purchasing/PurchaseInvoiceForm';
import { listSuppliers } from '@/features/purchasing/api';

const VARIANT: PickedVariant = {
  id: 'var-1',
  sku: 'TS-M-BLACK',
  size: 'M',
  color: 'Black',
  mrp: null,
  itemName: 'T-Shirt',
  minPrice: null,
  maxPrice: null,
};

vi.mock('@/features/catalog/VariantPicker', () => ({
  VariantPicker: ({ onPick }: { onPick: (variant: PickedVariant) => void }) => (
    <button type="button" onClick={() => onPick(VARIANT)}>
      pick
    </button>
  ),
}));
vi.mock('@/features/purchasing/api', () => ({ createInvoice: vi.fn(), listSuppliers: vi.fn() }));
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({ branchId: 'branch-1' }),
}));

const line = (qty: string, unitCost: string) => ({
  variantId: 'var-1',
  label: 'T-Shirt',
  sku: 'TS',
  qty,
  unitCost,
});

describe('draftLineTotalPaisa', () => {
  it.each([
    ['1.5', '100', 15_000],
    ['0.125', '80.00', 1_000],
    ['1.5', '3.33', 500], // 4.995 rounds half up, like the server
    ['2', '450.00', 90_000],
    ['', '450.00', 0],
    ['abc', '450.00', 0],
    ['2', '', 0],
  ])('%s × %s = %s paisa', (qty, unitCost, expected) => {
    expect(draftLineTotalPaisa(line(qty, unitCost))).toBe(expected);
  });
});

describe('PurchaseInvoiceForm', () => {
  beforeEach(() => {
    vi.mocked(listSuppliers).mockResolvedValue({
      data: [],
      meta: { count: 0, page: 1, total_pages: 1, page_size: 25 },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PurchaseInvoiceForm onCreated={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>,
    );
  });

  it('adds to the existing line when the same variant is picked again', () => {
    const pick = screen.getByRole('button', { name: 'pick' });
    fireEvent.click(pick);
    fireEvent.change(screen.getByLabelText(/unit cost for/i), { target: { value: '450' } });
    fireEvent.change(screen.getByLabelText(/quantity for/i), { target: { value: '1.001' } });

    fireEvent.click(pick);

    expect(screen.getAllByLabelText(/quantity for/i)).toHaveLength(1);
    expect(screen.getByLabelText(/quantity for/i)).toHaveValue('2.001');
    expect(screen.getByLabelText(/unit cost for/i)).toHaveValue('450');
  });

  it('keeps an unreadable quantity for the user to fix', () => {
    const pick = screen.getByRole('button', { name: 'pick' });
    fireEvent.click(pick);
    fireEvent.change(screen.getByLabelText(/quantity for/i), { target: { value: '2x' } });

    fireEvent.click(pick);

    expect(screen.getByLabelText(/quantity for/i)).toHaveValue('2x');
  });
});
