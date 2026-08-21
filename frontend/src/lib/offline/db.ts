/**
 * Dexie (IndexedDB) database for the offline POS.
 *
 * Two stores:
 * - `saleOps` — pending/failed offline sales, drained against the existing
 *   idempotent `POST /sales` (see sync.ts). Auto-increment `seq` preserves
 *   FIFO order; `idempotencyKey` is unique so a double-enqueue replays
 *   instead of duplicating.
 * - `variantCache` — variant lookup rows the billing screen has fetched,
 *   so barcode/SKU lookup keeps working offline (see catalogCache.ts).
 *
 * One database per tenant origin — the tenant comes from the host, so an
 * origin never holds another tenant's data. Entity shapes live here (the
 * schema layer); operations live in queue.ts / catalogCache.ts.
 */

import Dexie from 'dexie';
import type { Table } from 'dexie';

import type { CreateSalePayload } from '@/features/billing/api';

export type SaleOpStatus = 'pending' | 'failed';

/** One offline-queued sale. */
export interface QueuedSaleOp {
  /** Dexie auto-increment — the FIFO drain order. */
  seq?: number;
  /** Generated at enqueue time; retries of this op always reuse it. */
  idempotencyKey: string;
  /** Provisional reference shown on the offline receipt (never an invoice
   *  number — gapless numbering is assigned at sync time, server-side). */
  localRef: string;
  payload: CreateSalePayload;
  attempts: number;
  lastError: string | null;
  status: SaleOpStatus;
  enqueuedAt: string;
  failedAt: string | null;
}

/** A variant row cached for offline barcode/SKU lookup. */
export interface CachedVariant {
  id: string;
  sku: string;
  barcode: string | null;
  size: string;
  color: string;
  mrp: string | null;
  itemName: string;
  cachedAt: string;
}

export class OfflineDb extends Dexie {
  saleOps!: Table<QueuedSaleOp, number>;
  variantCache!: Table<CachedVariant, string>;

  constructor(name = 'dokan-offline') {
    super(name);
    this.version(1).stores({
      saleOps: '++seq, &idempotencyKey, status',
      variantCache: 'id, barcode, sku',
    });
  }
}

export const offlineDb = new OfflineDb();
