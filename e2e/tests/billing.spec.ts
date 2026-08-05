import { expect, test } from '../fixtures';
import { BillingPage } from '../pages/BillingPage';

// Seeded demo catalog (apps/tenants/management/commands/seed_demo.py).
const TEE_SKU = 'TEE-01-M-BLACK';
const TEE_LABEL = 'Plain T-Shirt — M / Black';

test.describe('billing', () => {
  test.beforeEach(async ({ api }) => {
    // Invariant 12: completing a sale requires an open cash session.
    const branch = await api.getDefaultBranch();
    await api.ensureCashSession(branch.id);
  });

  test('scan an item into the cart', async ({ page }) => {
    const billing = new BillingPage(page);
    await billing.goto();

    await billing.scan(TEE_SKU);

    await expect(billing.cartLine(TEE_LABEL)).toBeVisible();
    await expect(billing.cartLine(TEE_LABEL)).toContainText(TEE_SKU);
  });

  test('scan -> add to cart -> complete a cash bill -> receipt appears', async ({ page }) => {
    const billing = new BillingPage(page);
    await billing.goto();

    await billing.scan(TEE_SKU);
    await expect(billing.cartLine(TEE_LABEL)).toBeVisible();

    await billing.completeCashSale();
    await billing.expectReceipt();
    await expect(page.getByText('Tender · CASH')).toBeVisible();

    // "New bill" resets back to an empty counter.
    await billing.startNewBill();
    await expect(page.getByText('Cart is empty — scan an item to start a bill.')).toBeVisible();
  });
});
