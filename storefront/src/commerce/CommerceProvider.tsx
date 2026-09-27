import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import type { ShopperSession } from '../lib/api';

const CART_KEY = 'dokan.storefront.cart.v1';
const SESSION_KEY = 'dokan.storefront.session.v1';

export interface CartItem {
  variantId: string;
  productId: string;
  name: string;
  image: string | null;
  size: string;
  color: string;
  unitPrice: string;
  compareAt: string | null;
  qty: number;
}

interface CommerceValue {
  items: CartItem[];
  itemCount: number;
  session: ShopperSession | null;
  addItem: (item: CartItem) => void;
  setQuantity: (variantId: string, qty: number) => void;
  removeItem: (variantId: string) => void;
  clearCart: () => void;
  setSession: (session: ShopperSession) => void;
  signOut: () => void;
}

const CommerceContext = createContext<CommerceValue | null>(null);

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function initialItems(): CartItem[] {
  const stored = readStored<unknown>(CART_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (item): item is CartItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as CartItem).variantId === 'string' &&
      typeof (item as CartItem).productId === 'string' &&
      typeof (item as CartItem).unitPrice === 'string' &&
      Number.isFinite((item as CartItem).qty) &&
      (item as CartItem).qty > 0,
  );
}

function initialSession(): ShopperSession | null {
  const stored = readStored<unknown>(SESSION_KEY, null);
  if (
    typeof stored === 'object' &&
    stored !== null &&
    typeof (stored as ShopperSession).token === 'string' &&
    typeof (stored as ShopperSession).customer?.email === 'string'
  ) {
    return stored as ShopperSession;
  }
  return null;
}

function normalizeQuantity(qty: number): number {
  return Math.max(0, Math.min(999, Math.floor(qty)));
}

export function CommerceProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(initialItems);
  const [session, updateSession] = useState<ShopperSession | null>(initialSession);

  useEffect(() => localStorage.setItem(CART_KEY, JSON.stringify(items)), [items]);
  useEffect(() => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }, [session]);

  const addItem = useCallback((item: CartItem) => {
    const incoming = normalizeQuantity(item.qty);
    if (!incoming) return;
    setItems((current) => {
      const existing = current.find((line) => line.variantId === item.variantId);
      if (!existing) return [...current, { ...item, qty: incoming }];
      return current.map((line) =>
        line.variantId === item.variantId
          ? { ...line, qty: normalizeQuantity(line.qty + incoming) }
          : line,
      );
    });
  }, []);

  const setQuantity = useCallback((variantId: string, qty: number) => {
    const next = normalizeQuantity(qty);
    setItems((current) =>
      next
        ? current.map((line) => (line.variantId === variantId ? { ...line, qty: next } : line))
        : current.filter((line) => line.variantId !== variantId),
    );
  }, []);

  const removeItem = useCallback(
    (variantId: string) => setItems((current) => current.filter((line) => line.variantId !== variantId)),
    [],
  );
  const clearCart = useCallback(() => setItems([]), []);
  const setSession = useCallback((value: ShopperSession) => updateSession(value), []);
  const signOut = useCallback(() => updateSession(null), []);
  const itemCount = items.reduce((total, item) => total + item.qty, 0);

  const value = useMemo<CommerceValue>(
    () => ({
      items,
      itemCount,
      session,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
      setSession,
      signOut,
    }),
    [
      items,
      itemCount,
      session,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
      setSession,
      signOut,
    ],
  );

  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
}

export function useCommerce(): CommerceValue {
  const value = useContext(CommerceContext);
  if (!value) throw new Error('useCommerce must be used inside CommerceProvider');
  return value;
}
