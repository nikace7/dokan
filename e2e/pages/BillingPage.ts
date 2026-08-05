import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * /billing — the POS counter. Scan-first: the scan field is autofocused and
 * Enter adds the line. A completed sale swaps the whole screen for the
 * receipt panel.
 */
export class BillingPage {
  readonly scanInput: Locator;

  constructor(private readonly page: Page) {
    this.scanInput = page.getByLabel('Scan barcode or type SKU');
  }

  async goto() {
    await this.page.goto('/billing');
    await expect(this.scanInput).toBeVisible();
  }

  /** Type a barcode/SKU into the scan field and submit with Enter. */
  async scan(code: string) {
    await this.scanInput.fill(code);
    await this.scanInput.press('Enter');
  }

  /** A cart row, identified by its "Item — Size / Color" label. */
  cartLine(label: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRegExp(label)) });
  }

  /** Blank tender amount = full total; default method is CASH. */
  async completeCashSale() {
    await this.page
      .getByRole('button', { name: 'F9 Complete sale + print / बिल सेभ + प्रिन्ट' })
      .click();
  }

  /** The receipt panel replaces the billing screen after completion. */
  async expectReceipt() {
    await expect(this.page.getByText('Sale completed')).toBeVisible();
    await expect(this.page.getByRole('heading', { name: /^Invoice / })).toBeVisible();
  }

  async invoiceNumber(): Promise<string> {
    const heading = this.page.getByRole('heading', { name: /^Invoice / });
    await expect(heading).toBeVisible();
    return (await heading.textContent()) ?? '';
  }

  async startNewBill() {
    await this.page.getByRole('button', { name: 'New bill / नयाँ बिल' }).click();
    await expect(this.scanInput).toBeVisible();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
