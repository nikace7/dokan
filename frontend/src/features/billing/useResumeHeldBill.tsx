import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getSale, holdSale } from '@/features/billing/api';
import { cartPayload, serverMessage } from '@/features/billing/cartModel';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError, attemptDone, attemptKey } from '@/lib/api/client';
import { toPaisa } from '@/lib/money';
import { discountProblem, useCartStore } from '@/stores/cartStore';

/** A parked bill stays parked when the cart moves on; any other would be lost. */
function hasBillToLose(): boolean {
  const { lines, heldSaleId } = useCartStore.getState();
  return lines.length > 0 && heldSaleId === null;
}

/**
 * Load a parked bill into the cart, asking first when that would wipe a bill
 * in progress. Render `notice` next to the button that calls `resume`.
 */
export function useResumeHeldBill(onResumed?: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (id: string) => {
    const linesBefore = useCartStore.getState().lines;
    const invoice = await getSale(id);
    const cart = useCartStore.getState();
    if (cart.unconfirmedSale) {
      setAskingFor(null);
      setError(t('billing.resumeGuard.unconfirmed'));
      return;
    }
    if (cart.lines !== linesBefore && hasBillToLose()) {
      setAskingFor(id);
      return;
    }
    cart.resumeHeld(
      invoice.id,
      invoice.items.map((item) => ({
        variantId: item.variant,
        sku: item.variant_sku,
        label: item.item_name,
        quantity: Number(item.qty),
        unitPricePaisa: toPaisa(item.unit_price),
        discountPaisa: toPaisa(item.discount),
      })),
      invoice.customer && invoice.customer_name
        ? { id: invoice.customer, name: invoice.customer_name, phone: '' }
        : null,
      toPaisa(invoice.total),
    );
    setAskingFor(null);
    onResumed?.();
  };

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('billing.resumeGuard.openError'));
    } finally {
      setIsBusy(false);
    }
  };

  const resume = (id: string) => {
    setError(null);
    if (useCartStore.getState().unconfirmedSale) setError(t('billing.resumeGuard.unconfirmed'));
    else if (hasBillToLose()) setAskingFor(id);
    else void run(() => open(id));
  };

  const parkAndOpen = async (id: string) => {
    const { lines, clear } = useCartStore.getState();
    if (lines.some(discountProblem)) {
      setError(t('billing.errors.fixDiscount'));
      return;
    }
    try {
      const payload = cartPayload(workspace.branchId, workspace.rateTypeId);
      await holdSale(payload, attemptKey('hold', payload));
    } catch (err) {
      setError(serverMessage(err));
      return;
    }
    attemptDone('hold');
    clear();
    void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    setAskingFor(null);
    await open(id);
  };

  const message = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;

  const notice = askingFor ? (
    <Dialog open onOpenChange={(isOpen) => !isOpen && !isBusy && setAskingFor(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('billing.resumeGuard.title')}</DialogTitle>
          <DialogDescription>{t('billing.resumeGuard.body')}</DialogDescription>
        </DialogHeader>
        {message}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={isBusy} onClick={() => setAskingFor(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={isBusy}
            onClick={() => void run(() => open(askingFor))}
          >
            {t('billing.resumeGuard.discard')}
          </Button>
          <Button loading={isBusy} onClick={() => void run(() => parkAndOpen(askingFor))}>
            {t('billing.resumeGuard.park')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : (
    message
  );

  return { resume, isBusy, notice };
}
