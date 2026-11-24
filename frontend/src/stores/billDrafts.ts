import type { StoreApi } from 'zustand';

import { useCartStore } from '@/stores/cartStore';
import { useSimpleSaleStore } from '@/stores/simpleSaleStore';

/**
 * Unfinished bills survive a reload, one per person and branch.
 *
 * ponytail: sessionStorage, so two tabs stay two bills. A closed tab loses its
 * bill; localStorage would keep it but needs a rule for which tab owns it.
 */
interface Bill {
  lines: unknown[];
  clear: () => void;
}
const BILLS: Record<string, Pick<StoreApi<Bill>, 'getState' | 'setState' | 'subscribe'>> = {
  billing: useCartStore as unknown as StoreApi<Bill>,
  simple: useSimpleSaleStore as unknown as StoreApi<Bill>,
};

const userPrefix = (userId: string) => `dokan.draft.${userId}.`;

/** Whose bills are in memory; null saves nothing. */
let owner: string | null = null;

for (const [name, store] of Object.entries(BILLS)) {
  store.subscribe((state) => {
    if (owner) save(`${owner}.${name}`, state);
  });
}

function save(key: string, state: Bill): void {
  try {
    if (state.lines.length === 0) sessionStorage.removeItem(key);
    // billNo belongs to this page load: a restored bill takes a fresh one.
    else sessionStorage.setItem(key, JSON.stringify({ ...state, billNo: undefined }));
  } catch {
    // Storage full or blocked: the bill still works, it just cannot survive a reload.
  }
}

function load(key: string): Bill | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Bill | null;
    return Array.isArray(draft?.lines) ? draft : null;
  } catch {
    return null;
  }
}

/** Swap the bills in memory for this person's bills at this branch. */
export function openDrafts(userId: string, branchId: string | null): void {
  const next = branchId && userPrefix(userId) + branchId;
  if (owner === next || (!next && owner?.startsWith(userPrefix(userId)))) return;
  // Scanned before the branch was known; belongs to the bill about to open.
  const early = owner === null && !useCartStore.getState().heldSaleId;
  const scanned = early ? useCartStore.getState().lines : [];
  owner = null;
  for (const [name, store] of Object.entries(BILLS)) {
    store.getState().clear();
    const draft = next && load(`${next}.${name}`);
    if (draft) store.setState(draft);
  }
  owner = next;
  const { heldSaleId, unconfirmedSale, addLine } = useCartStore.getState();
  if (!heldSaleId && !unconfirmedSale) scanned.forEach(addLine);
}

/** Shared counters: the next person must not inherit this person's bills. */
export function forgetDrafts(userId: string | undefined): void {
  for (const store of Object.values(BILLS)) store.getState().clear();
  if (!userId) return;
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(userPrefix(userId)))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Nothing could be stored, so nothing is left behind.
  }
}
