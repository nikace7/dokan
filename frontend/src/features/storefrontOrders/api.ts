import { authedRequest } from '@/lib/api/authed';

export type OnlineOrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OnlineOrderItem {
  name: string;
  size: string;
  color: string;
  unit_price: string;
  compare_at: string | null;
  qty: string;
  line_total: string;
}

export interface OnlineOrder {
  id: string;
  number_text: string;
  status: OnlineOrderStatus;
  fulfillment: 'DELIVERY' | 'PICKUP';
  payment_method: 'COD';
  payment_status: 'PENDING' | 'PAID' | 'REFUNDED';
  address: Record<string, unknown> | null;
  note: string;
  currency: 'NPR' | 'INR';
  subtotal: string;
  total: string;
  offer_text: string;
  tracking_token: string;
  business_date_ad: string;
  business_date_bs: string;
  created_at: string;
  customer: { email: string; full_name: string; phone: string };
  branch: { id: string; name: string };
  sales_invoice: { id: string; status: 'HELD' | 'COMPLETED' | 'CANCELLED'; invoice_no: number | null } | null;
  items: OnlineOrderItem[];
}

export function listOnlineOrders(status?: OnlineOrderStatus): Promise<OnlineOrder[]> {
  const query = status ? `?status=${status}` : '';
  return authedRequest<OnlineOrder[]>(`/v1/storefront/manage/orders${query}`);
}

export function prepareOnlineOrder(id: string): Promise<OnlineOrder> {
  return authedRequest<OnlineOrder>(`/v1/storefront/manage/orders/${id}/prepare`, {
    method: 'POST',
  });
}

export function advanceOnlineOrder(id: string): Promise<OnlineOrder> {
  return authedRequest<OnlineOrder>(`/v1/storefront/manage/orders/${id}/advance`, {
    method: 'POST',
  });
}

export function cancelOnlineOrder(id: string): Promise<OnlineOrder> {
  return authedRequest<OnlineOrder>(`/v1/storefront/manage/orders/${id}/cancel`, {
    method: 'POST',
  });
}
