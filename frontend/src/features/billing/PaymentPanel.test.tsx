import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { searchCustomers } from '@/features/billing/api';
import { PaymentPanel } from '@/features/billing/PaymentPanel';
import { useCartStore } from '@/stores/cartStore';
import { useCurrencyStore } from '@/stores/currency';

vi.mock('@/features/billing/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchCustomers: vi.fn(),
}));

const onComplete = vi.fn();
const SITA = { id: 'c-1', name: 'Sita Rai', phone: '9811111111' };

function renderPanel(props: { allowVatBill?: boolean; chargesVat?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PaymentPanel busy={false} allowVatBill={false} onComplete={onComplete} {...props} />
    </QueryClientProvider>,
  );
}

const pay = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const complete = () => fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));
const row = (label: RegExp) => screen.getByText(label).nextElementSibling?.textContent;

describe('PaymentPanel', () => {
  beforeEach(() => {
    onComplete.mockReset();
    vi.mocked(searchCustomers).mockResolvedValue([]);
    useCurrencyStore.setState({ base: 'NPR', display: 'NPR' });
    useCartStore.getState().clear();
    useCartStore.getState().addLine({
      variantId: 'v-1',
      sku: 'SKU-1',
      label: 'T-Shirt',
      quantity: 1,
      unitPricePaisa: 102_000,
      discountPaisa: 0,
      vatApplicable: true,
    });
  });

  it('takes the exact total when the amount is left blank', () => {
    renderPanel();
    complete();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CASH', amountPaisa: 102_000, changePaisa: 0 }),
    );
  });

  it('shows the change and records only the bill total when more cash is handed over', () => {
    renderPanel();
    pay(/cash received/i, '1500');

    expect(row(/change to return/i)).toBe('रू\u00a0480.00');
    expect(row(/^paid$/i)).toBe('रू\u00a01,020.00');
    complete();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaisa: 102_000, changePaisa: 48_000 }),
    );
  });

  it('offers one QR button instead of a button per wallet', () => {
    renderPanel();
    const methods = screen.getByRole('group', { name: /payment method/i });
    expect(Array.from(methods.querySelectorAll('button'), (b) => b.textContent)).toEqual([
      'Cash',
      'QR',
      'Udharo',
    ]);
  });

  it('shows no change to return while the bill is empty', () => {
    useCartStore.getState().clear();
    renderPanel();
    pay(/cash received/i, '3000');
    expect(row(/change to return/i)).toBe('रू 0.00');
  });

  it('refuses a QR payment above the total on the field', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'QR' }));
    pay(/^amount/i, '1500');

    expect(screen.getByLabelText(/^amount/i)).toBeInvalid();
    expect(screen.getByRole('alert')).toHaveTextContent(/more than the bill total/i);
    complete();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-5'])('refuses %s as an amount on the field', (value) => {
    renderPanel();
    pay(/cash received/i, value);
    expect(screen.getByLabelText(/cash received/i)).toBeInvalid();
    complete();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('asks who owes the rest when the payment is short', () => {
    renderPanel();
    expect(screen.queryByLabelText(/search customers/i)).not.toBeInTheDocument();
    pay(/cash received/i, '500');

    expect(row(/^due/i)).toBe('रू\u00a0520.00');
    expect(screen.getByLabelText(/search customers/i)).toBeInTheDocument();
    complete();
    expect(screen.getByRole('alert')).toHaveTextContent(/requires a customer/i);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('accepts a part payment once the customer is picked', () => {
    useCartStore.getState().setCustomer(SITA);
    renderPanel();
    pay(/cash received/i, '500');
    complete();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CASH', amountPaisa: 50_000 }),
    );
  });

  it('shows who the bill is for even when nothing is due', () => {
    useCartStore.getState().setCustomer(SITA);
    renderPanel();
    expect(screen.getByText('Sita Rai')).toBeInTheDocument();
  });

  it('puts the whole bill on udharo with no amount to type', () => {
    useCartStore.getState().setCustomer(SITA);
    renderPanel();
    pay(/cash received/i, '500');
    fireEvent.click(screen.getByRole('button', { name: /udharo/i }));

    expect(screen.queryByRole('textbox', { name: /amount|cash received/i })).toBeNull();
    complete();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CREDIT', amountPaisa: 102_000 }),
    );
  });

  it('asks for and shows the shop currency while prices are viewed in INR', () => {
    useCurrencyStore.setState({ display: 'INR' });
    renderPanel();

    expect(screen.getByLabelText(/cash received \(रू\)/i)).toBeInTheDocument();
    expect(row(/bill total/i)).toBe('रू\u00a01,020.00');
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('adds VAT to the total of a VAT bill', () => {
    renderPanel({ allowVatBill: true, chargesVat: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /vat bill/i }));

    expect(row(/vat 13%/i)).toBe('रू\u00a0132.60');
    expect(row(/bill total/i)).toBe('रू\u00a01,152.60');
    complete();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaisa: 115_260, isVatBill: true }),
    );
  });

  it('adds no VAT when the shop is not VAT registered', () => {
    renderPanel({ allowVatBill: true, chargesVat: false });
    fireEvent.click(screen.getByRole('checkbox', { name: /vat bill/i }));
    expect(row(/bill total/i)).toBe('रू\u00a01,020.00');
  });

  it('offers no VAT choice on a held bill, which the server already fixed', () => {
    const { lines } = useCartStore.getState();
    useCartStore.getState().resumeHeld('sale-1', lines, null, 102_000);
    renderPanel({ allowVatBill: true, chargesVat: true });
    expect(screen.queryByRole('checkbox', { name: /vat bill/i })).not.toBeInTheDocument();
  });

  it('refuses to complete while a discount is wrong', () => {
    useCartStore.getState().setDiscount('v-1', 'abc');
    renderPanel();
    complete();
    expect(screen.getByRole('alert')).toHaveTextContent(/fix the discount/i);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
