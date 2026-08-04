import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api/client';
import {
  completeSale,
  createSale,
  currentSaleContext,
  holdSale,
  paisaToApiString,
} from '@/features/billing/api';
import type { CreateSalePayload, SalesInvoice } from '@/features/billing/api';
import { CartTable } from '@/features/billing/CartTable';
import { HeldBillsPanel } from '@/features/billing/HeldBillsPanel';
import type { Tender } from '@/features/billing/PaymentPanel';
import { PaymentPanel } from '@/features/billing/PaymentPanel';
import { ReceiptPanel } from '@/features/billing/ReceiptPanel';
import { ScanInput } from '@/features/billing/ScanInput';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { useCartStore } from '@/stores/cartStore';

function serverMessage(err: unknown): string {
  // The server's error.message is shown verbatim — it carries codes like
  // STOCK_INSUFFICIENT / CREDIT_LIMIT_EXCEEDED the counter must see.
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

/**
 * The billing screen — the product's flagship surface (§7.3). Scan-first,
 * keyboard-friendly, one sale per page state. A completed sale swaps the
 * whole screen for the receipt; "New bill" resets.
 */
export function BillingPage() {
  const lines = useCartStore((s) => s.lines);
  const customer = useCartStore((s) => s.customer);
  const heldSaleId = useCartStore((s) => s.heldSaleId);
  const clear = useCartStore((s) => s.clear);
  const queryClient = useQueryClient();
  const workspace = useWorkspace();

  const [receipt, setReceipt] = useState<SalesInvoice | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);

  const buildBasePayload = (): Omit<CreateSalePayload, 'payments' | 'is_vat_bill'> => {
    if (!workspace.branchId || !workspace.rateTypeId) {
      throw new Error('Select an active branch and rate type before billing.');
    }
    return {
      ...currentSaleContext(workspace.branchId, workspace.rateTypeId),
      customer: customer?.id,
      lines: lines.map((line) => ({
        variant: line.variantId,
        qty: String(line.quantity),
        discount: paisaToApiString(line.discountPaisa),
      })),
    };
  };

  const buildSalePayload = (tender: Tender): CreateSalePayload => ({
    ...buildBasePayload(),
    payments: [{ method: tender.method, amount: paisaToApiString(tender.amountPaisa) }],
    is_vat_bill: tender.isVatBill,
  });

  const saleMutation = useMutation({
    // One Idempotency-Key per bill attempt (per Complete click). Mutations
    // are not auto-retried (see providers.tsx), and the key would be reused
    // if a manual retry of the SAME attempt is ever added — never regenerated.
    mutationFn: ({ tender, key }: { tender: Tender; key: string }) => {
      if (heldSaleId) {
        return completeSale(
          heldSaleId,
          [{ method: tender.method, amount: paisaToApiString(tender.amountPaisa) }],
          key,
        );
      }
      return createSale(buildSalePayload(tender), key);
    },
    onSuccess: (invoice) => {
      setReceipt(invoice);
      setSaleError(null);
      clear();
      void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    },
    onError: (err) => setSaleError(serverMessage(err)),
  });

  const holdMutation = useMutation({
    mutationFn: () => holdSale(buildBasePayload(), crypto.randomUUID()),
    onSuccess: () => {
      setSaleError(null);
      clear();
      void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    },
    onError: (err) => setSaleError(serverMessage(err)),
  });

  if (receipt) {
    return (
      <main className="p-6">
        <ReceiptPanel invoice={receipt} onNewBill={() => setReceipt(null)} />
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_360px]">
      {workspace.isLoading ? (
        <p
          role="status"
          className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 lg:col-span-2"
        >
          Loading branches and rate types…
        </p>
      ) : !workspace.isReady ? (
        <p
          role="alert"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 lg:col-span-2"
        >
          Billing needs an active branch and rate type. Configure them in the header or finish
          tenant setup first.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <Card>
          <ScanInput />
        </Card>
        <Card title={heldSaleId ? 'Bill (resumed from held)' : 'Bill'}>
          <CartTable />
        </Card>
      </div>

      <div>
        <Card title="Payment / भुक्तानी">
          <PaymentPanel
            busy={saleMutation.isPending}
            disabled={!workspace.isReady}
            onComplete={(tender) => saleMutation.mutate({ tender, key: crypto.randomUUID() })}
          />
          <div className="mt-3 border-t border-slate-200 pt-3">
            <button
              type="button"
              disabled={
                holdMutation.isPending ||
                lines.length === 0 ||
                heldSaleId !== null ||
                !workspace.isReady
              }
              onClick={() => holdMutation.mutate()}
              className="text-sm text-slate-600 underline hover:text-slate-900 disabled:text-slate-300"
            >
              {holdMutation.isPending ? 'Parking…' : 'Park this bill (hold)'}
            </button>
          </div>
          {saleError ? (
            <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {saleError}
            </p>
          ) : null}
        </Card>
        <HeldBillsPanel />
      </div>
    </main>
  );
}
