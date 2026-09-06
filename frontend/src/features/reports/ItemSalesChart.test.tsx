import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemSalesChart } from '@/features/reports/ItemSalesChart';
import type { ItemSalesRow } from '@/features/reports/api';

const LONG_NAME = 'Northface Matching GoreTex Jacket With Removable Inner Layer';

const ROWS: ItemSalesRow[] = Array.from({ length: 10 }, (_, index) => ({
  variant_id: `variant-${index}`,
  sku: `SKU-${index}`,
  item_name: index === 0 ? LONG_NAME : `Product ${index + 1}`,
  size: index === 0 ? 'Free Size' : 'M',
  color: index === 0 ? 'Standard' : 'Black',
  qty: String(10 - index),
  amount: String((10 - index) * 750),
}));

class ChartResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 760,
            height: 444,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve() {}
  disconnect() {}
}

describe('ItemSalesChart', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', ChartResizeObserver));
  afterEach(() => vi.unstubAllGlobals());

  it('gives each product a non-overlapping, truncated two-line label', () => {
    render(<ItemSalesChart rows={ROWS} />);

    const chart = screen.getByRole('img', { name: 'Top selling items by quantity' });
    expect(chart).toHaveStyle({ height: '444px' });

    const labels = screen.getAllByTestId('item-chart-axis-label');
    expect(labels).toHaveLength(10);
    const longLabel = screen.getByLabelText(`${LONG_NAME}, Free Size / Standard`);
    expect(longLabel).toHaveTextContent('Northface Matching GoreTex…');
    expect(longLabel).toHaveTextContent('Free Size / Standard');
    expect(longLabel).not.toHaveTextContent(LONG_NAME);
  });

  it('lets the user compare quantity sold with sales amount', () => {
    render(<ItemSalesChart rows={ROWS} />);

    const quantity = screen.getByRole('button', { name: 'Quantity sold' });
    const amount = screen.getByRole('button', { name: 'Sales amount' });
    expect(quantity).toHaveAttribute('aria-pressed', 'true');
    expect(amount).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(amount);

    expect(amount).toHaveAttribute('aria-pressed', 'true');
    expect(quantity).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img', { name: 'Top selling items by sales amount' })).toBeVisible();
  });
});
