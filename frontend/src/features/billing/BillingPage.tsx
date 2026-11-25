import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError, isNetworkError, isUnconfirmed } from '@/lib/api/client';
import { completeSale, createSale, holdSale, paisaToApiString } from '@/features/billing/api';
import type { CreateSalePayload, PlanUsageWarning, SalesInvoice } from '@/features/billing/api';
import { cartPayload } from '@/features/billing/cartModel';
import { CartTable } from '@/features/billing/CartTable';
import { HeldBillsPanel } from '@/features/billing/HeldBillsPanel';
import type { Tender } from '@/features/billing/PaymentPanel';
import { PaymentPanel } from '@/features/billing/PaymentPanel';
import { ReceiptPanel } from '@/features/billing/ReceiptPanel';
import { SaleErrorNotice } from '@/features/billing/SaleErrorNotice';
import { ScanInput } from '@/features/billing/ScanInput';
import { SyncStatusBanner } from '@/features/billing/SyncStatusBanner';
import { UnconfirmedSaleNotice } from '@/features/billing/UnconfirmedSaleNotice';
import { useRepriceCart } from '@/features/billing/useRepriceCart';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { enqueueSale } from '@/lib/offline/queue';
import { refreshSyncState } from '@/lib/offline/sync';
import { formatBaseMoney } from '@/lib/money';
import type { Paisa } from '@/lib/money';
import { hasPlanFeature } from '@/lib/plans';
import { usePageTitle } from '@/lib/usePageTitle';
import { discountProblem, useCartStore } from '@/stores/cartStore';
import type { UnconfirmedSale } from '@/stores/cartStore';

/**
 * The billing screen — the product's flagship surface (§7.3). Scan-first,
 * keyboard-friendly, one sale per page state. A completed sale swaps the
 * whole screen for the receipt; "New bill" resets.
 */
export function BillingPage() {
  const lines = useCartStore((s) => s.lines);
  const billNo = useCartStore((s) => s.billNo);
  const heldSaleId = useCartStore((s) => s.heldSaleId);
  const clear = useCartStore((s) => s.clear);
  const unconfirmedSale = useCartStore((s) => s.unconfirmedSale);
  const setUnconfirmedSale = useCartStore((s) => s.setUnconfirmedSale);
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { user } = useAuth();
  const { t } = useTranslation();
  usePageTitle(t('nav.billing'));

  const repricing = useRepriceCart(workspace.rateTypeId);

  const [receipt, setReceipt] = useState<SalesInvoice | null>(null);
  const [queuedRef, setQueuedRef] = useState<string | null>(null);
  const [planWarning, setPlanWarning] = useState<PlanUsageWarning | null>(null);
  const [saleError, setSaleError] = useState<unknown>(null);
  const [changePaisa, setChangePaisa] = useState<Paisa>(0);

  const buildSalePayload = (tender: Tender): CreateSalePayload => ({
    ...cartPayload(workspace.branchId, workspace.rateTypeId),
    payments: [{ method: tender.method, amount: paisaToApiString(tender.amountPaisa) }],
    is_vat_bill: tender.isVatBill,
  });

  const saleMutation = useMutation({
    mutationKey: ['sale'],
    // Offline must fail now, not pause and bill later on reconnect.
    networkMode: 'always',
    // One Idempotency-Key per bill attempt (per Complete click). A new sale is
    // recorded as unconfirmed BEFORE it is sent and stays locked until a
    // definite answer, so a retry always re-sends the same payload and key.
    // (A held bill needs none of this: the server completes its id only once.)
    mutationFn: ({ payload, key }: UnconfirmedSale) =>
      heldSaleId
        ? completeSale(heldSaleId, payload.payments, key, payload.customer)
        : createSale(payload, key),
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
      setSaleError(err);
    },
  });

  const holdMutation = useMutation({
    mutationKey: ['sale'],
    networkMode: 'always',
    mutationFn: () =>
      holdSale(cartPayload(workspace.branchId, workspace.rateTypeId), crypto.randomUUID()),
    onSuccess: () => {
      setSaleError(null);
      clear();
      void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    },
    onError: setSaleError,
  });
  const hold = () => {
    setSaleError(null);
    if (lines.some(discountProblem)) setSaleError(t('billing.errors.fixDiscount'));
    else holdMutation.mutate();
  };
  // Nothing on the bill may change while the server might already hold it.
  const locked = saleMutation.isPending || holdMutation.isPending || unconfirmedSale !== null;
  const changeNotice =
    changePaisa > 0 ? (
      <p
        role="status"
        className="receipt-screen-only mx-auto mb-4 max-w-lg rounded-md bg-green-50 px-3 py-2 text-center text-xl font-bold text-green-800"
      >
        {t('billing.changeDue')}: {formatBaseMoney(changePaisa)}
      </p>
    ) : null;

  if (queuedRef) {
    return (
      <main className="p-4 sm:p-6">
        {changeNotice}
        <Card className="mx-auto max-w-lg text-center">
          <p className="text-sm font-medium text-blue-700">{t('billing.queuedTitle')}</p>
          <h1 className="mt-1 text-2xl font-bold">{t('billing.queuedRef', { ref: queuedRef })}</h1>
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
        {changeNotice}
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
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Hidden: the counter screen needs the height. */}
      <h1 className="sr-only">{t('nav.billing')}</h1>
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

      <fieldset disabled={locked || heldSaleId !== null} className="flex min-w-0 flex-col gap-4">
        <Card>
          <ScanInput rateTypeId={workspace.rateTypeId} />
        </Card>
        <Card title={heldSaleId ? t('billing.billResumed') : t('billing.bill')}>
          <CartTable />
        </Card>
      </fieldset>

      <div>
        <Card title={t('billing.payment')}>
          {heldSaleId ? (
            <div className="mb-3 flex flex-col items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <p>{t('billing.heldLocked')}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => {
                  setSaleError(null);
                  clear();
                }}
              >
                {t('billing.heldLeave')}
              </Button>
            </div>
          ) : null}
          {repricing.error ? (
            <div
              role="alert"
              className="mb-3 flex flex-col items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <p>
                {repricing.error instanceof ApiError
                  ? repricing.error.message
                  : t('billing.errors.repriceFailed')}
              </p>
              <Button variant="outline" size="sm" onClick={repricing.retry}>
                {t('billing.unconfirmed.retry')}
              </Button>
            </div>
          ) : repricing.isStale ? (
            <p role="status" className="mb-3 text-sm text-slate-600">
              {t('billing.repricing')}
            </p>
          ) : null}
          <fieldset disabled={locked} className="min-w-0">
            <PaymentPanel
              key={billNo}
              busy={saleMutation.isPending}
              disabled={!workspace.isReady || locked || repricing.isStale}
              allowVatBill={hasPlanFeature(user, 'vat_module')}
              chargesVat={user?.vat_registered}
              onComplete={(tender) => {
                setChangePaisa(tender.changePaisa);
                saleMutation.mutate({
                  payload: buildSalePayload(tender),
                  key: crypto.randomUUID(),
                });
              }}
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
                onClick={hold}
                className="text-sm text-slate-600 underline hover:text-slate-900 disabled:text-slate-300 max-md:min-h-11"
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
            <div className="mt-3">
              <SaleErrorNotice error={saleError} />
            </div>
          ) : null}
        </Card>
        <fieldset disabled={locked} className="min-w-0">
          <HeldBillsPanel />
        </fieldset>
      </div>
    </main>
  );
}
