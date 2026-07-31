import { beforeEach, describe, expect, it } from 'vitest';

import type { CartLine } from '@/stores/cartStore';
import { cartTotalPaisa, lineTotalPaisa, useCartStore } from '@/stores/cartStore';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    variantId: 'v-1',
    sku: 'SKU-1',
    label: 'T-Shirt — M / Black',
    quantity: 1,
    unitPricePaisa: 150_000, // रू 1,500.00
    discountPaisa: 0,
    ...overrides,
  };
}

describe('cartStore', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it('adds a new line and merges repeat scans of the same variant', () => {
    useCartStore.getState().addLine(line());
    useCartStore.getState().addLine(line({ quantity: 2 }));

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it('keeps an entered discount when a repeat scan merges', () => {
    useCartStore.getState().addLine(line());
    useCartStore.getState().setDiscount('v-1', 10_000);
    useCartStore.getState().addLine(line());

    expect(useCartStore.getState().lines[0].discountPaisa).toBe(10_000);
  });

  it('keeps different variants as separate lines', () => {
    useCartStore.getState().addLine(line());
    useCartStore.getState().addLine(line({ variantId: 'v-2', sku: 'SKU-2' }));

    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it('updates quantity and removes the line when quantity drops to zero', () => {
    useCartStore.getState().addLine(line());
    useCartStore.getState().setQuantity('v-1', 5);
    expect(useCartStore.getState().lines[0].quantity).toBe(5);

    useCartStore.getState().setQuantity('v-1', 0);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('removes lines and clears the whole cart including customer and held state', () => {
    useCartStore.getState().addLine(line());
    useCartStore.getState().addLine(line({ variantId: 'v-2', sku: 'SKU-2' }));
    useCartStore.getState().setCustomer({ id: 'c-1', name: 'Ram', phone: '9811111111' });

    useCartStore.getState().removeLine('v-1');
    expect(useCartStore.getState().lines.map((l) => l.variantId)).toEqual(['v-2']);

    useCartStore.getState().resumeHeld('sale-1', [], null);
    useCartStore.getState().clear();
    const state = useCartStore.getState();
    expect(state.lines).toHaveLength(0);
    expect(state.customer).toBeNull();
    expect(state.heldSaleId).toBeNull();
  });

  it('computes display-only totals in integer paisa', () => {
    const lines = [
      line({ quantity: 2, unitPricePaisa: 150_000, discountPaisa: 25_000 }), // 2,750.00
      line({ variantId: 'v-2', quantity: 3, unitPricePaisa: 99_950 }), // 2,998.50
    ];
    expect(lineTotalPaisa(lines[0])).toBe(275_000);
    expect(lineTotalPaisa(lines[1])).toBe(299_850);
    expect(cartTotalPaisa(lines)).toBe(574_850);
  });

  it('floors a line total at zero when the discount exceeds the line', () => {
    expect(lineTotalPaisa(line({ discountPaisa: 999_999 }))).toBe(0);
  });
});
