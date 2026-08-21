import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { useCurrencyStore } from '@/stores/currency';

function MoneyProbe() {
  useMoneyDisplay();
  return <span>{formatNpr('160.00')}</span>;
}

describe('useMoneyDisplay', () => {
  beforeEach(() => {
    localStorage.clear();
    useCurrencyStore.getState().setDisplay('NPR');
  });

  it('re-renders formatted amounts when the display currency toggles', () => {
    render(<MoneyProbe />);

    expect(screen.getByText('रू 160.00')).toBeInTheDocument();

    act(() => {
      useCurrencyStore.getState().setDisplay('INR');
    });

    // NRB peg: 1 INR = 1.6 NPR, so NPR 160.00 renders as INR 100.00.
    expect(screen.getByText('₹ 100.00')).toBeInTheDocument();
  });
});
