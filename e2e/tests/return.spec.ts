import { test } from '../fixtures';
import { ReturnsPage } from '../pages/ReturnsPage';

// Seeded demo catalog (seed_demo): SH-01 Oxford Shirt, MRP 2800.00.
const SHIRT_SKU = 'SH-01-M-BLACK';
const SHIRT_NAME = 'Oxford Shirt';

test.describe('returns', () => {
  test('return a line from a completed bill as a credit note', async ({ page, api }) => {
    // Arrange a completed cash sale through the API, then drive the return
    // through the real UI.
    const branch = await api.getDefaultBranch();
    await api.ensureCashSession(branch.id);
    const rateType = await api.getDefaultRateType();
    const variant = await api.lookupVariantBySku(SHIRT_SKU);
    const invoice = await api.createCashSale({
      branchId: branch.id,
      rateTypeId: rateType.id,
      variantId: variant.id,
      qty: '2',
      amount: '5600.00',
    });
    if (invoice.invoice_no === null) {
      throw new Error('Expected a completed, numbered invoice from the API setup.');
    }

    const returns = new ReturnsPage(page);
    await returns.goto();
    await returns.openInvoice(invoice.invoice_no);
    await returns.returnLine(SHIRT_NAME, '1', 'Customer changed size — E2E');
    await returns.expectRecorded();
  });
});
