import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VariantForSale } from '@/features/billing/api';
import { forgetDrafts, openDrafts } from '@/stores/billDrafts';
import type { CartLine, UnconfirmedSale } from '@/stores/cartStore';
import { useCartStore } from '@/stores/cartStore';
import { useSimpleSaleStore } from '@/stores/simpleSaleStore';

const LINE: CartLine = {
  variantId: 'v-1',
  sku: 'SKU-1',
  label: 'T-Shirt',
  quantity: 2,
  unitPricePaisa: 150_000,
  discountPaisa: 1_000,
  discountRaw: '10',
};
const RAM = { id: 'c-1', name: 'Ram', phone: '9811111111' };
const UNCONFIRMED = { payload: { branch: 'b-1' }, key: 'key-1' } as unknown as UnconfirmedSale;
const SIMPLE_LINE = { key: 'l-1', variant: { id: 'v-2' } as VariantForSale, qty: '1', price: '9' };

const cart = () => useCartStore.getState();
const simple = () => useSimpleSaleStore.getState();

/** What a reload does: memory is gone, the tab's storage is not. */
async function reload() {
  vi.resetModules();
  return {
    ...(await import('@/stores/billDrafts')),
    cart: (await import('@/stores/cartStore')).useCartStore,
    simple: (await import('@/stores/simpleSaleStore')).useSimpleSaleStore,
  };
}

describe('bill drafts', () => {
  beforeEach(() => {
    sessionStorage.clear();
    openDrafts('test', 'reset');
    cart().clear();
    simple().clear();
    openDrafts('user-1', 'branch-1');
  });

  it('brings both bills back after a reload', async () => {
    cart().addLine(LINE);
    cart().setCustomer(RAM);
    useSimpleSaleStore.setState({ lines: [SIMPLE_LINE], tender: 'QR' });

    const after = await reload();
    after.openDrafts('user-1', 'branch-1');

    expect(after.cart.getState()).toMatchObject({ lines: [LINE], customer: RAM });
    expect(after.simple.getState()).toMatchObject({ lines: [SIMPLE_LINE], tender: 'QR' });
  });

  it('keeps an unanswered sale locked to the same key after a reload', async () => {
    cart().addLine(LINE);
    cart().setUnconfirmedSale(UNCONFIRMED);

    const after = await reload();
    after.openDrafts('user-1', 'branch-1');

    expect(after.cart.getState().unconfirmedSale).toEqual(UNCONFIRMED);
  });

  it('keeps one bill per branch', () => {
    cart().addLine(LINE);
    const billNo = cart().billNo;

    openDrafts('user-1', 'branch-2');
    expect(cart().lines).toEqual([]);
    expect(cart().billNo).not.toBe(billNo);
    cart().addLine({ ...LINE, variantId: 'v-9' });

    openDrafts('user-1', 'branch-1');
    expect(cart().lines).toEqual([LINE]);
    expect(cart().billNo).not.toBe(billNo);
  });

  it("never shows one person's bill to another", () => {
    cart().addLine(LINE);
    openDrafts('user-2', 'branch-1');
    expect(cart().lines).toEqual([]);

    openDrafts('user-1', 'branch-1');
    expect(cart().lines).toEqual([LINE]);
  });

  it('hides the last bill while the next person has no branch yet', () => {
    cart().addLine(LINE);
    openDrafts('user-2', null);
    expect(cart().lines).toEqual([]);
    openDrafts('user-1', 'branch-1');
    expect(cart().lines).toEqual([LINE]);
  });

  it('adds what was scanned before the branch was known to the saved bill', () => {
    cart().addLine(LINE);
    openDrafts('user-2', null);
    cart().addLine({ ...LINE, variantId: 'v-9' });
    openDrafts('user-2', 'branch-1');
    expect(cart().lines.map((l) => l.variantId)).toEqual(['v-9']);

    openDrafts('user-1', 'branch-1');
    expect(cart().lines).toEqual([LINE]);
  });

  it('keeps the bill in memory when the same counter is opened again', () => {
    cart().addLine(LINE);
    sessionStorage.clear();
    openDrafts('user-1', null);
    openDrafts('user-1', 'branch-1');
    expect(cart().lines).toEqual([LINE]);
  });

  it('leaves nothing behind once a bill is finished', () => {
    cart().addLine(LINE);
    cart().clear();
    expect(sessionStorage).toHaveLength(0);
  });

  it('forgets every bill of the person signing out, and only theirs', () => {
    cart().addLine(LINE);
    openDrafts('user-1', 'branch-2');
    useSimpleSaleStore.setState({ lines: [SIMPLE_LINE] });
    openDrafts('user-2', 'branch-1');
    cart().addLine(LINE);
    openDrafts('user-1', 'branch-2');

    forgetDrafts('user-1');
    expect(simple().lines).toEqual([]);
    openDrafts('user-1', 'branch-1');
    expect(cart().lines).toEqual([]);
    openDrafts('user-2', 'branch-1');
    expect(cart().lines).toEqual([LINE]);
  });

  it.each(['not json', 'null', '{"lines":"x"}'])('ignores a broken draft: %s', (raw) => {
    sessionStorage.setItem('dokan.draft.user-3.branch-1.billing', raw);
    openDrafts('user-3', 'branch-1');
    expect(cart().lines).toEqual([]);
  });

  it('bills on when the browser refuses to store anything', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    cart().addLine(LINE);
    expect(cart().lines).toEqual([LINE]);
    setItem.mockRestore();
  });
});
