import i18n from 'i18next';

import { currentSaleContext, paisaToApiString } from '@/features/billing/api';
import type { CreateSalePayload, VariantLookup } from '@/features/billing/api';
import { ApiError } from '@/lib/api/client';
import { toPaisa } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';
import type { LinePricing } from '@/stores/cartStore';

/** The cart as a sale/hold request, without the payment. */
export function cartPayload(
  branchId: string | null,
  rateTypeId: string | null,
): Omit<CreateSalePayload, 'payments' | 'is_vat_bill'> {
  if (!branchId || !rateTypeId) {
    throw new Error('Select an active branch and rate type before billing.');
  }
  const { customer, lines } = useCartStore.getState();
  return {
    ...currentSaleContext(branchId, rateTypeId),
    customer: customer?.id,
    lines: lines.map((line) => ({
      variant: line.variantId,
      qty: String(line.quantity),
      discount: paisaToApiString(line.discountPaisa),
      // A typed price is sent; otherwise the server charges the rate's price.
      ...(line.priceRaw === undefined ? {} : { unit_price: paisaToApiString(line.unitPricePaisa) }),
    })),
  };
}

/** What a looked-up variant costs at the rate it was looked up for. */
export function linePricing(variant: VariantLookup, rateTypeId: string | null): LinePricing {
  return {
    unitPricePaisa: toPaisa(variant.price ?? variant.mrp ?? '0'),
    vatApplicable: variant.item__is_vat_applicable ?? false,
    rateTypeId,
  };
}

export function serverMessage(err: unknown): string {
  // The server's error.message is shown verbatim — it carries codes like
  // STOCK_INSUFFICIENT / CREDIT_LIMIT_EXCEEDED the counter must see.
  return err instanceof ApiError ? err.message : i18n.t('common.networkError');
}
