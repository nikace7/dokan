import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api/client';
import { createSale, currentSaleContext, paisaToApiString } from '@/features/billing/api';
import type { PaymentMethod, PlanUsageWarning, SalesInvoice, VariantForSale } from '@/features/billing/api';
import { ItemPickerDialog } from '@/features/billing/ItemPickerDialog';
import { ReceiptPanel } from '@/features/billing/ReceiptPanel';
import { ShareBillPanel } from '@/features/billing/ShareBillPanel';
import { SimpleSaleLineCard } from '@/features/billing/SimpleSaleLineCard';
import { grandTotalPaisa, linesValid } from '@/features/billing/simpleSaleModel';
import type { SimpleLine } from '@/features/billing/simpleSaleModel';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { formatPaisa, toPaisa } from '@/lib/money';
import { useSyncStore } from '@/lib/offline/sync';
import { hasPermission } from '@/lib/permissions';

type TenderMethod = Extract<PaymentMethod, 'CASH' | 'QR'>;

function saleErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CASH_SESSION_REQUIRED') {
      // Invariant 12: completion needs an open drawer. The cashier cannot
      // open one, so point them at the person who can.
      return 'The day is not open yet — ask the owner/manager to open the cash session first. / दिन खुलेको छैन — पहिले क्यास सत्र खोल्न मालिक वा म्यानेजरलाई भन्नुहोस्।';
    }
    // Bounds/stock rejections carry a counter-readable server message.
    return err.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
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
  const online = useSyncStore((s) => s.online);

  const [lines, setLines] = useState<SimpleLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tender, setTender] = useState<TenderMethod>('CASH');
  const [receipt, setReceipt] = useState<SalesInvoice | null>(null);
  const [planWarning, setPlanWarning] = useState<PlanUsageWarning | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  // One Idempotency-Key per composed bill; a failed Complete retries with the
  // SAME key (a safe replay), and only a completed/new bill rotates it.
  const idempotencyKey = useRef(crypto.randomUUID());

  const total = grandTotalPaisa(lines);
  const canSubmit =
    online && workspace.isReady && linesValid(lines) && total > 0;

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
        <Card title="Simple sale / सरल बिक्री">
          <p role="alert" className="text-sm text-muted-foreground">
            You do not have permission to create sales. / बिक्री गर्ने अनुमति छैन।
          </p>
        </Card>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        {planWarning ? (
          <p role="status" className="mb-4 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
            You have used {planWarning.usage} of {planWarning.limit} monthly bills. Billing remains
            available; contact support if you need a higher plan.
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
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col gap-3 p-4 pb-28">
      <h1 className="text-xl font-semibold">Simple sale / सरल बिक्री</h1>

      {!online ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          You are offline — simple sale needs a connection. / इन्टरनेट छैन — सरल बिक्रीका लागि
          कनेक्सन चाहिन्छ।
        </p>
      ) : null}

      {workspace.isLoading ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          Loading branches and rate types…
        </p>
      ) : !workspace.isReady ? (
        <p role="alert" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          Billing needs an active branch and rate type. Configure them in the header or finish
          tenant setup first.
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
        + वस्तु थप्नुहोस् / Add item
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

      {/* Sticky above the mobile bottom tab bar (h-14); flush at md+ where it hides. */}
      <div className="fixed inset-x-0 bottom-14 border-t border-border bg-card p-3 shadow-lg md:bottom-0">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div
            role="group"
            aria-label="Payment method / भुक्तानी विधि"
            className="grid grid-cols-2 gap-2"
          >
            {(
              [
                ['CASH', 'नगद Cash'],
                ['QR', 'QR'],
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
              ? 'Saving…'
              : `बिल बनाउनुहोस् Complete · ${formatPaisa(total, { symbol: 'रू ' })}`}
          </Button>
          {saleError ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saleError}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
