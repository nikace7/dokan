import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { CartTable } from '@/features/billing/CartTable';
import { useCartStore } from '@/stores/cartStore';
import { useCurrencyStore } from '@/stores/currency';

const discount = () => screen.getByLabelText('Discount for T-Shirt');
const type = (value: string) => fireEvent.change(discount(), { target: { value } });

describe('CartTable', () => {
  beforeEach(() => {
    useCurrencyStore.setState({ base: 'NPR', display: 'NPR' });
    useCartStore.getState().clear();
    useCartStore.getState().addLine({
      variantId: 'v-1',
      sku: 'SKU-1',
      label: 'T-Shirt',
      quantity: 1,
      unitPricePaisa: 100_000,
      discountPaisa: 0,
    });
  });

  it('counts the discount as it is typed, so F9 cannot outrun it', () => {
    render(<CartTable />);
    type('150');
    expect(screen.getAllByText('रू 850.00').length).toBeGreaterThan(0);
  });

  it.each([
    ['abc', /valid discount/i],
    ['99999', /more than the line/i],
  ])('shows why a discount of %s is refused on the field', (value, reason) => {
    render(<CartTable />);
    type(value);
    expect(discount()).toBeInvalid();
    expect(discount()).toHaveValue(value);
    expect(discount()).toHaveAccessibleDescription(reason);
  });

  it('lets the discount be cleared again', () => {
    render(<CartTable />);
    type('150');
    type('');
    expect(discount()).toBeValid();
    expect(useCartStore.getState().lines[0].discountPaisa).toBe(0);
  });

  it('asks for the discount in the shop currency while viewing INR', () => {
    useCurrencyStore.setState({ display: 'INR' });
    useCartStore.getState().setDiscount('v-1', '160');
    render(<CartTable />);
    expect(screen.getByRole('columnheader', { name: 'Discount (रू)' })).toBeInTheDocument();
    expect(discount()).toHaveValue('160');
  });

  it('names every amount for the phone, where the column headings are gone', () => {
    render(<CartTable />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells.map((cell) => cell.dataset.label)).toEqual([
      undefined,
      undefined,
      'Rate',
      'Discount (रू)',
      'Total',
      undefined,
    ]);
    // One set of controls for both layouts, so nothing can be edited twice.
    expect(screen.getAllByLabelText('Discount for T-Shirt')).toHaveLength(1);
  });

  it('charges a held bill what was stored when it was parked', () => {
    const { lines } = useCartStore.getState();
    useCartStore.getState().resumeHeld('sale-1', lines, null, 84_000);
    render(<CartTable />);
    expect(screen.getAllByRole('row').at(-1)).toHaveTextContent('840.00');
  });
});
