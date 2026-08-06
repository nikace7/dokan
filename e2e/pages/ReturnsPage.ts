import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** /returns — credit notes against completed bills. */
export class ReturnsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/returns');
    await expect(
      this.page.getByRole('heading', { name: 'Returns', exact: true }),
    ).toBeVisible();
  }

  /** Expand the row for a completed invoice (newest bills list first). */
  async openInvoice(invoiceNo: number) {
    await this.page
      .getByRole('button', { name: new RegExp(`^Invoice ${invoiceNo}\\b`) })
      .first()
      .click();
  }

  async returnLine(itemName: string, qty: string, reason: string) {
    await this.page.getByLabel(`Return quantity for ${itemName}`).fill(qty);
    await this.page.getByLabel('Reason').fill(reason);
    await this.page.getByRole('button', { name: 'Record return' }).click();
  }

  async expectRecorded() {
    await expect(this.page.getByRole('status')).toContainText('Return recorded.');
  }
}
