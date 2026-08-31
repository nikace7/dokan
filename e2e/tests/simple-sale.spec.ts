import type { Browser } from '@playwright/test';

import { expect, test } from '../fixtures';
import { config } from '../config';
import { SimpleSalePage } from '../pages/SimpleSalePage';

// Seeded demo catalog (seed_demo): JW-01 Denim Jacket, MRP 4500.00, M/L Black.
const JACKET_ROW = /Denim Jacket — M \/ Black/;
const JACKET_LINE = 'Denim Jacket — M / Black';

// The shared-bill page is public, so it is exercised from a fresh browser
// context with no storage state. Manually created contexts do not inherit the
// config's `use` options, so baseURL / ignoreHTTPSErrors are passed along.
async function newGuestPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL: config.baseURL,
    ignoreHTTPSErrors: true,
  });
  // Pin English — the app otherwise defaults to Nepali on first run.
  await context.addInitScript(() => localStorage.setItem('dokan-lang', 'en'));
  const page = await context.newPage();
  return { context, page };
}

test.describe('simple sale', () => {
  test.beforeEach(async ({ api }) => {
    // Invariant 12: completing a sale requires an open cash session.
    const branch = await api.getDefaultBranch();
    await api.ensureCashSession(branch.id);
  });

  test('Billing nav opens the simple sale; add an item and complete a cash bill', async ({
    page,
  }) => {
    await page.goto('/');
    const sale = new SimpleSalePage(page);
    await sale.gotoViaNav();

    await sale.addItem('Denim', JACKET_ROW);
    await expect(sale.lineCard(JACKET_LINE)).toBeVisible();

    await sale.payWith('CASH');
    await sale.complete();
    await sale.expectReceipt();
    expect(await sale.invoiceNumber()).toMatch(/^Invoice /);
  });

  test('share a QR-paid bill and read it unauthenticated via the public link', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const sale = new SimpleSalePage(page);
    await sale.gotoViaNav();
    await sale.addItem('Denim', JACKET_ROW);
    await sale.payWith('QR');
    await sale.complete();
    await sale.expectReceipt();
    const invoice = await sale.invoiceNumber();

    const sharePath = await sale.shareBill();
    expect(sharePath).toMatch(/^\/bill\//);

    // A brand-new context: no storage state, no auth tokens.
    const guest = await newGuestPage(browser);
    try {
      await guest.page.goto(sharePath);
      await expect(
        guest.page.getByRole('heading', { name: 'Everest Outfitters' }),
      ).toBeVisible();
      await expect(guest.page.getByRole('heading', { name: invoice })).toBeVisible();
      await expect(guest.page.getByText(/Denim Jacket/)).toBeVisible();
      await expect(guest.page.getByText('Total', { exact: true }).first()).toBeVisible();
      // No login redirect — the link alone authorizes the read.
      await expect(guest.page).toHaveURL(new RegExp(escapeRegExp(sharePath)));
    } finally {
      await guest.context.close();
    }
  });

  test('an unknown share token shows the friendly not-found state', async ({ browser }) => {
    const guest = await newGuestPage(browser);
    try {
      await guest.page.goto(`/bill/${crypto.randomUUID()}`);
      await expect(
        guest.page.getByRole('heading', { name: /Bill not found/ }),
      ).toBeVisible();
      await expect(guest.page.getByText(/link is no longer valid/)).toBeVisible();
    } finally {
      await guest.context.close();
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
