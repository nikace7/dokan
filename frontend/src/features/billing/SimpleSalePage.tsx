import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api/client';
import { createSale, currentSaleContext, paisaToApiString } from '@/features/billing/api';
import type {
  PaymentMethod,
  PlanUsageWarning,
  SalesInvoice,
  VariantForSale,
} from '@/features/billing/api';
import { ItemPickerDialog } from '@/features/billing/ItemPickerDialog';
import { ReceiptPanel } from '@/features/billing/ReceiptPanel';
import { ShareBillPanel } from '@/features/billing/ShareBillPanel';
import { SimpleSaleLineCard } from '@/features/billing/SimpleSaleLineCard';
import { SimpleSaleQuickPick } from '@/features/billing/SimpleSaleQuickPick';
import { grandTotalPaisa, linesValid } from '@/features/billing/simpleSaleModel';
import type { SimpleLine } from '@/features/billing/simpleSaleModel';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { formatPaisa, toPaisa, useMoneyDisplay } from '@/lib/money';
import { useSyncStore } from '@/lib/offline/sync';
import { hasPermission } from '@/lib/permissions';

type TenderMethod = Extract<PaymentMethod, 'CASH' | 'QR'>;

function saleErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CASH_SESSION_REQUIRED') {
      // Invariant 12: completion needs an open drawer. The cashier cannot
      // open one, so point them at the person who can.
      return i18n.t('simpleSale.cashSessionRequired');
    }
    // Bounds/stock rejections carry a counter-readable server message.
    return err.message;
  }
  return i18n.t('common.networkError');
}

let lineCounter = 0;
function newLine(variant: VariantForSale): SimpleLine {
  lineCounter += 1;
  return {
    key: `line-${lineCounter}`,
    variant,
    qty: '1',
    price: variant.mrp ?? '',
  };
}

/**
 * The simple sale screen (`/billing/simple`) — the plan-gated alternative to
 * the advanced POS. Pick in-stock items, adjust price within the allowed
 * range, take one tender (cash or QR), done. No customer, no held bills, no
 * offline queue — Complete is disabled while offline.
 */
export function SimpleSalePage() {
  const workspace = useWorkspace();
  const { user } = useAuth();
  const { t } = useTranslation();
  const online = useSyncStore((s) => s.online);
  useMoneyDisplay();

  const [lines, setLines] = useState<SimpleLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tender, setTender] = useState<TenderMethod>('CASH');
  const [receipt, setReceipt] = useState<SalesInvoice | null>(null);
  const [planWarning, setPlanWarning] = useState<PlanUsageWarning | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  // One Idempotency-Key per composed bill; a failed Complete retries with the
  // SAME key (a safe replay), and only a completed/new bill rotates it.
  const idempotencyKey = useRef(crypto.randomUUID());

  // The tender bar is FIXED so it stays rigid at the viewport bottom while
  // scrolling (sticky visibly followed the scroll). An in-flow spacer of
  // exactly the bar's height keeps the last line from sliding underneath;
  // ResizeObserver tracks the bar growing/shrinking (error line, wraps).
  const tenderBarRef = useRef<HTMLDivElement | null>(null);
  const [tenderBarHeight, setTenderBarHeight] = useState(0);
  useLayoutEffect(() => {
    const bar = tenderBarRef.current;
    if (!bar) return;
    const measure = () => setTenderBarHeight(bar.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const total = grandTotalPaisa(lines);
  const canSubmit = online && workspace.isReady && linesValid(lines) && total > 0;

  const saleMutation = useMutation({
    mutationFn: () => {
      if (!workspace.branchId || !workspace.rateTypeId) {
        throw new Error('Select an active branch and rate type before billing.');
      }
      return createSale(
        {
          ...currentSaleContext(workspace.branchId, workspace.rateTypeId),
          lines: lines.map((line) => ({
            variant: line.variant.id,
            qty: String(Number(line.qty)),
            // linesValid() gates submission, so these parse cleanly.
            unit_price: paisaToApiString(toPaisa(line.price)),
            discount: '0.00',
          })),
          payments: [{ method: tender, amount: paisaToApiString(total) }],
          is_vat_bill: false,
        },
        idempotencyKey.current,
      );
    },
    onSuccess: ({ invoice, planWarning: warning }) => {
      setReceipt(invoice);
      setPlanWarning(warning);
      setSaleError(null);
      setLines([]);
      idempotencyKey.current = crypto.randomUUID();
    },
    onError: (err) => setSaleError(saleErrorMessage(err)),
  });

  if (user && !hasPermission(user, 'sale.create')) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <Card title={t('simpleSale.title')}>
          <p role="alert" className="text-sm text-muted-foreground">
            {t('simpleSale.noPermission')}
          </p>
        </Card>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        {planWarning ? (
          <p
            role="status"
            className="mb-4 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
          >
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
        <div className="receipt-screen-only">
          <ShareBillPanel invoice={receipt} />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4">
      <PageHeader title={t('simpleSale.title')} />

      {!online ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {t('simpleSale.offline')}
        </p>
      ) : null}

      {workspace.isLoading ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {t('billing.workspaceLoading')}
        </p>
      ) : !workspace.isReady ? (
        <p role="alert" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {t('billing.workspaceNotReady')}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {lines.map((line) => (
          <SimpleSaleLineCard
            key={line.key}
            line={line}
            onChange={(key, patch) =>
              setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
            }
            onRemove={(key) => setLines((current) => current.filter((l) => l.key !== key))}
          />
        ))}
      </div>

      <Button
        variant="outline"
        size="lg"
        className="w-full border-dashed"
        disabled={!workspace.isReady}
        onClick={() => setPickerOpen(true)}
      >
        + {t('simpleSale.addItem')}
      </Button>

      <ItemPickerDialog
        open={pickerOpen}
        branchId={workspace.branchId}
        onOpenChange={setPickerOpen}
        onPick={(variant) => {
          setLines((current) => [...current, newLine(variant)]);
          setPickerOpen(false);
        }}
      />

      {/* Quick-pick photo grid fills the otherwise empty page and lets the
          counter tap items straight onto the bill; hidden while offline or
          before the workspace resolves (the banners above explain why). */}
      {online && workspace.isReady && workspace.branchId ? (
        <SimpleSaleQuickPick
          branchId={workspace.branchId}
          onPick={(variant) => setLines((current) => [...current, newLine(variant)])}
        />
      ) : null}

      {/* In-flow spacer exactly the bar's height, so the last line and any
          error message stay scrollable clear of the fixed bar. */}
      <div aria-hidden="true" style={{ height: tenderBarHeight }} />

      {/* Fixed tender bar: rigid at the viewport bottom while scrolling,
          above the mobile tab bar (h-14), flush and clearing the sidebar at
          md+. The inner row keeps the controls centered over the page
          column. */}
      <div
        ref={tenderBarRef}
        data-testid="tender-bar"
        className="fixed inset-x-0 bottom-14 z-20 border-t border-border bg-card shadow-lg md:bottom-0 md:left-60"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-3">
          <div
            role="group"
            aria-label={t('simpleSale.paymentMethod')}
            className="grid grid-cols-2 gap-2"
          >
            {(
              [
                ['CASH', t('simpleSale.cash')],
                ['QR', t('simpleSale.qr')],
              ] as const
            ).map(([method, label]) => (
              <button
                key={method}
                type="button"
                aria-pressed={tender === method}
                onClick={() => setTender(method)}
                className={
                  tender === method
                    ? 'h-12 rounded-md bg-primary text-base font-semibold text-primary-foreground shadow-sm'
                    : 'h-12 rounded-md border border-input bg-background text-base font-medium hover:bg-accent'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            size="lg"
            className="h-14 w-full text-lg"
            disabled={!canSubmit || saleMutation.isPending}
            onClick={() => saleMutation.mutate()}
          >
            {saleMutation.isPending
              ? t('simpleSale.saving')
              : `${t('simpleSale.complete')} · ${formatPaisa(total, { symbol: 'auto' })}`}
          </Button>
          {saleError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {saleError}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
