import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError, isNetworkError, isUnconfirmed } from '@/lib/api/client';
import {
  completeSale,
  createSale,
  currentSaleContext,
  holdSale,
  paisaToApiString,
} from '@/features/billing/api';
import type { CreateSalePayload, PlanUsageWarning, SalesInvoice } from '@/features/billing/api';
import { CartTable } from '@/features/billing/CartTable';
import { HeldBillsPanel } from '@/features/billing/HeldBillsPanel';
import type { Tender } from '@/features/billing/PaymentPanel';
import { PaymentPanel } from '@/features/billing/PaymentPanel';
import { ReceiptPanel } from '@/features/billing/ReceiptPanel';
import { ScanInput } from '@/features/billing/ScanInput';
import { SyncStatusBanner } from '@/features/billing/SyncStatusBanner';
import { UnconfirmedSaleNotice } from '@/features/billing/UnconfirmedSaleNotice';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { enqueueSale } from '@/lib/offline/queue';
import { refreshSyncState } from '@/lib/offline/sync';
import { hasPlanFeature } from '@/lib/plans';
import { useCartStore } from '@/stores/cartStore';
import type { UnconfirmedSale } from '@/stores/cartStore';

function serverMessage(err: unknown): string {
  // The server's error.message is shown verbatim — it carries codes like
  // STOCK_INSUFFICIENT / CREDIT_LIMIT_EXCEEDED the counter must see.
  if (err instanceof ApiError) {
    return err.message;
  }
  return i18n.t('common.networkError');
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
  const unconfirmedSale = useCartStore((s) => s.unconfirmedSale);
  const setUnconfirmedSale = useCartStore((s) => s.setUnconfirmedSale);
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { user } = useAuth();
  const { t } = useTranslation();

  const [receipt, setReceipt] = useState<SalesInvoice | null>(null);
  const [queuedRef, setQueuedRef] = useState<string | null>(null);
  const [planWarning, setPlanWarning] = useState<PlanUsageWarning | null>(null);
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
    // One Idempotency-Key per bill attempt (per Complete click). A new sale is
    // recorded as unconfirmed BEFORE it is sent and stays locked until a
    // definite answer, so a retry always re-sends the same payload and key.
    // (A held bill needs none of this: the server completes its id only once.)
    mutationFn: ({ payload, key }: UnconfirmedSale) =>
      heldSaleId ? completeSale(heldSaleId, payload.payments, key) : createSale(payload, key),
    onMutate: (sale) => {
      setSaleError(null);
      if (!heldSaleId) setUnconfirmedSale(sale);
    },
    onSuccess: ({ invoice, planWarning: warning }) => {
      setReceipt(invoice);
      setPlanWarning(warning);
      setSaleError(null);
      clear();
      void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    },
    onError: (err, variables) => {
      // Network down for a NEW sale: queue it with the SAME Idempotency-Key
      // the attempt already used, so the sync drain replays safely. A 4xx
      // is a real rejection (stock, credit limit, …) and never queues.
      // Held-bill completion needs the server id — it stays online-only.
      if (!heldSaleId && isNetworkError(err)) {
        void enqueueSale(variables.payload, variables.key).then(async (op) => {
          setQueuedRef(op.localRef);
          setSaleError(null);
          clear();
          await refreshSyncState();
        });
        return;
      }
      if (!heldSaleId && isUnconfirmed(err)) return;
      setUnconfirmedSale(null);
      setSaleError(serverMessage(err));
    },
  });
  // Nothing on the bill may change while the server might already hold it.
  const locked = saleMutation.isPending || unconfirmedSale !== null;

  const holdMutation = useMutation({
    mutationFn: () => holdSale(buildBasePayload(), crypto.randomUUID()),
    onSuccess: () => {
      setSaleError(null);
      clear();
      void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    },
    onError: (err) => setSaleError(serverMessage(err)),
  });

  if (queuedRef) {
    return (
      <main className="p-4 sm:p-6">
        <Card className="mx-auto max-w-lg text-center">
          <p className="text-sm font-medium text-blue-700">{t('billing.queuedTitle')}</p>
          <h2 className="mt-1 text-2xl font-bold">{t('billing.queuedRef', { ref: queuedRef })}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('billing.queuedBody')}</p>
          <Button size="lg" className="mt-6 w-full" onClick={() => setQueuedRef(null)} autoFocus>
            {t('billing.receipt.newBill')}
          </Button>
        </Card>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="p-4 sm:p-6">
        {planWarning ? (
          <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('billing.planWarning', {
              usage: planWarning.usage,
              limit: planWarning.limit,
            })}
          </p>
        ) : null}
        <ReceiptPanel
          invoice={receipt}
          onNewBill={() => {
            setReceipt(null);
            setPlanWarning(null);
          }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_360px]">
      <SyncStatusBanner />
      {workspace.isLoading ? (
        <p
          role="status"
          className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 lg:col-span-2"
        >
          {t('billing.workspaceLoading')}
        </p>
      ) : !workspace.isReady ? (
        <p
          role="alert"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 lg:col-span-2"
        >
          {t('billing.workspaceNotReady')}
        </p>
      ) : null}

      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
        <Card>
          <ScanInput />
        </Card>
        <Card title={heldSaleId ? t('billing.billResumed') : t('billing.bill')}>
          <CartTable />
        </Card>
      </fieldset>

      <div>
        <Card title={t('billing.payment')}>
          <fieldset disabled={locked} className="min-w-0">
            <PaymentPanel
              busy={saleMutation.isPending}
              disabled={!workspace.isReady || locked}
              allowVatBill={hasPlanFeature(user, 'vat_module')}
              onComplete={(tender) =>
                saleMutation.mutate({
                  payload: buildSalePayload(tender),
                  key: crypto.randomUUID(),
                })
              }
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
                {holdMutation.isPending ? t('billing.parking') : t('billing.holdBill')}
              </button>
            </div>
          </fieldset>
          {unconfirmedSale && !saleMutation.isPending ? (
            <div className="mt-3">
              <UnconfirmedSaleNotice
                onRetry={() => saleMutation.mutate(unconfirmedSale)}
                onDiscard={clear}
              />
            </div>
          ) : null}
          {saleError ? (
            <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {saleError}
            </p>
          ) : null}
        </Card>
        <fieldset disabled={locked} className="min-w-0">
          <HeldBillsPanel />
        </fieldset>
      </div>
    </main>
  );
}
