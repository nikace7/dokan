import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommerceProvider, useCommerce } from './CommerceProvider';

const ITEM = {
  variantId: 'variant-1',
  productId: 'product-1',
  name: 'Linen Shirt',
  image: null,
  size: 'M',
  color: 'Blue',
  unitPrice: '1500.00',
  compareAt: null,
  qty: 1,
};

function wrapper({ children }: { children: ReactNode }) {
  return <CommerceProvider>{children}</CommerceProvider>;
}

describe('CommerceProvider', () => {
  beforeEach(() => localStorage.clear());

  it('combines duplicate variants and persists the cart', () => {
    const { result, unmount } = renderHook(() => useCommerce(), { wrapper });
    act(() => {
      result.current.addItem(ITEM);
      result.current.addItem({ ...ITEM, qty: 2 });
    });
    expect(result.current.items).toEqual([{ ...ITEM, qty: 3 }]);
    unmount();

    const restored = renderHook(() => useCommerce(), { wrapper });
    expect(restored.result.current.items).toEqual([{ ...ITEM, qty: 3 }]);
  });

  it('updates quantities, removes lines, and clears checkout state', () => {
    const { result } = renderHook(() => useCommerce(), { wrapper });
    act(() => result.current.addItem(ITEM));
    act(() => result.current.setQuantity('variant-1', 4));
    expect(result.current.itemCount).toBe(4);
    act(() => result.current.setQuantity('variant-1', 0));
    expect(result.current.items).toEqual([]);

    act(() => result.current.setSession({
      token: 'token',
      customer: { email: 'buyer@example.com', full_name: 'Sita', phone: '' },
    }));
    expect(result.current.session?.token).toBe('token');
    act(() => result.current.signOut());
    expect(result.current.session).toBeNull();
  });
});
