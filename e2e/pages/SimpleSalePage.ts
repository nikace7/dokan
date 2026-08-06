import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * /billing/simple — the plan-gated simple sale screen (the demo plan has
 * simple_sale=true, advanced_pos=false, so the Billing nav entry routes
 * here). Items come from the search picker (GET /catalog/variants/for-sale);
 * a completed sale swaps the screen for the receipt panel plus the
 * share-bill actions.
 */
export class SimpleSalePage {
  constructor(private readonly page: Page) {}

  /** Open Billing via the app nav and land on the simple sale screen. */
  async gotoViaNav() {
    await this.page.getByRole('link', { name: 'Billing', exact: true }).first().click();
    await expect(this.page).toHaveURL(/\/billing\/simple$/);
    await expect(
      this.page.getByRole('heading', { name: 'Simple sale' }),
    ).toBeVisible();
  }

  /** Open the picker, search, and pick the matching in-stock row. */
  async addItem(search: string, rowLabel: RegExp) {
    await this.page.getByRole('button', { name: /Add item/ }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Search items').fill(search);
    await dialog.getByRole('button', { name: rowLabel }).first().click();
  }

  /** The line card for a picked variant ("<item> — <size> / <color>"). */
  lineCard(label: string): Locator {
    return this.page.getByRole('region', { name: label });
  }

  /** The Cash/QR segmented tender toggle above the Complete button. */
  async payWith(method: 'CASH' | 'QR') {
    await this.page
      .getByRole('button', { name: method === 'CASH' ? 'Cash' : 'QR', exact: true })
      .click();
  }

  /** Complete the bill; the button carries the live total in its label. */
  async complete() {
    await this.page.getByRole('button', { name: /Complete ·/ }).click();
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

  /**
   * Mint the public share link from the Share panel (POST /sales/<id>/share)
   * and return the URL path (`/bill/<token>`).
   */
  async shareBill(): Promise<string> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          /\/api\/v1\/sales\/[^/]+\/share$/.test(new URL(res.url()).pathname),
      ),
      this.page.getByRole('button', { name: 'Share link' }).click(),
    ]);
    const body = (await response.json()) as { data: { share_url_path: string } };
    const path = body.data.share_url_path;
    // The panel renders the absolute link once the mutation lands.
    await expect(this.page.getByText(new RegExp(escapeRegExp(path)))).toBeVisible();
    return path;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
