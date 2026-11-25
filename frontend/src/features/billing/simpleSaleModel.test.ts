import { afterEach, beforeEach, expect, it } from 'vitest';

import type { VariantForSale } from '@/features/billing/api';
import { addVariant, priceError, priceRangeHint } from '@/features/billing/simpleSaleModel';
import { useCurrencyStore } from '@/stores/currency';

const VARIANT = {
  mrp: '1600.00',
  min_selling_price: '800.00',
  max_selling_price: '1600.00',
} as VariantForSale;

// The price is typed and charged in the shop currency, so its limits must be too.
beforeEach(() => useCurrencyStore.setState({ base: 'NPR', display: 'INR' }));
afterEach(() => useCurrencyStore.setState({ base: 'NPR', display: 'NPR' }));

it('shows the allowed range in the shop currency while viewing INR', () => {
  expect(priceRangeHint(VARIANT)).toContain('रू\u00a0800.00');
  expect(priceRangeHint(VARIANT)).toContain('रू\u00a01,600.00');
  expect(priceRangeHint({ ...VARIANT, min_selling_price: null, max_selling_price: null })).toBe(
    'MRP: रू\u00a01,600.00',
  );
});

it('adds one to the line of an item that is already on the bill', () => {
  const shirt = { ...VARIANT, id: 'shirt' };
  const jeans = { ...VARIANT, id: 'jeans' };
  const once = addVariant([], shirt);
  expect(once).toMatchObject([{ variant: shirt, qty: '1', price: '1600.00' }]);

  // The price typed for that line stays; a blank quantity counts as none.
  const bargained = once.map((line) => ({ ...line, price: '1500' }));
  expect(addVariant(addVariant(bargained, shirt), jeans)).toMatchObject([
    { variant: shirt, qty: '2', price: '1500' },
    { variant: jeans, qty: '1' },
  ]);
  expect(addVariant([{ ...once[0], qty: '' }], shirt)[0].qty).toBe('1');
});

it('names the limit a price breaks in the shop currency', () => {
  const line = (price: string) => ({ key: 'k', variant: VARIANT, qty: '1', price });
  expect(priceError(line('700'))).toContain('रू\u00a0800.00');
  expect(priceError(line('1700'))).toContain('रू\u00a01,600.00');
});
