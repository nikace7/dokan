/** Sharing a bill: a public link anyone with it can open. */
import { apiRequest } from '@/lib/api/client';
import { authedRequest } from '@/lib/api/authed';

import type { PaymentMethod } from '@/features/billing/api';

/** `POST /sales/<id>/share` response — the public-bill capability token. */
export interface ShareResult {
  share_token: string;
  share_url_path: string;
}

export function shareSale(id: string): Promise<ShareResult> {
  return authedRequest<ShareResult>(`/v1/sales/${id}/share`, { method: 'POST', body: {} });
}

/**
 * Public receipt payload (`apps/sales/serializers.py::SharedBillSerializer`).
 * Served without auth at `GET /sales/shared/<token>` — the token is the
 * capability. A subset of `SalesInvoice` (no customer PAN, no staff fields).
 */
export interface SharedBill {
  id: string;
  tenant_name: string;
  tenant_name_np: string | null;
  legal_name: string | null;
  pan_vat_no: string | null;
  vat_registered: boolean;
  invoice_prefix: string;
  branch_name: string;
  branch_name_np: string | null;
  branch_address: string | null;
  branch_phone: string | null;
  invoice_no: number | null;
  doc_type: string;
  customer_name: string | null;
  subtotal: string;
  discount_amount: string;
  taxable_amount: string;
  vat_amount: string;
  round_off: string;
  total: string;
  paid_amount: string;
  due_amount: string;
  status: string;
  is_vat_bill: boolean;
  tenders: Array<{ method: PaymentMethod; amount: string }>;
  datetime_ad: string;
  business_date_ad: string;
  business_date_bs: string;
  fiscal_year_bs: string;
  items: Array<{
    id: string;
    variant: string;
    variant_sku: string;
    item_name: string;
    item_name_np: string | null;
    qty: string;
    unit_price: string;
    discount: string;
    line_total: string;
  }>;
}

/** Public online bill — deliberately NOT authedRequest: anyone with the link reads it. */
export function getSharedBill(token: string): Promise<SharedBill> {
  return apiRequest<SharedBill>(`/v1/sales/shared/${token}`);
}
