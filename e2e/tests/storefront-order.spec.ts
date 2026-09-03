import { expect, test } from '../fixtures';
import { config } from '../config';
import { readLatestStorefrontOtp } from '../helpers/otp';

test('shopper checkout reaches the tenant online-order inbox', async ({ browser, page }) => {
  const shopper = await browser.newContext({
    baseURL: config.storefrontBaseURL,
    ignoreHTTPSErrors: true,
  });
  const store = await shopper.newPage();
  const email = `storefront-${Date.now()}@example.com`;

  try {
    await store.goto('/');
    await expect(store).toHaveTitle('Demo Store');

    // The seeded promotion appears once per visitor session.
    const popupClose = store.getByRole('button', { name: 'Close' }).last();
    await popupClose.waitFor({ state: 'visible' });
    await popupClose.click();

    await store.getByRole('button', { name: 'Quick view Plain T-Shirt' }).last().click();
    await store.getByRole('link', { name: 'Choose options' }).click();
    await store.getByRole('button', { name: 'M / Black', exact: true }).click();
    await store.getByRole('button', { name: 'Add to bag' }).click();
    await store.getByRole('link', { name: 'View bag (1)' }).click();
    await store.getByRole('link', { name: 'Continue to checkout' }).click();

    await store.getByLabel('Email address').fill(email);
    await store.getByRole('button', { name: 'Send login code' }).click();
    await expect(store.getByText(`Code sent to ${email}`)).toBeVisible();
    await store.getByLabel('6-digit code').fill(await readLatestStorefrontOtp(email));
    await store.getByRole('button', { name: 'Verify and continue' }).click();

    await expect(store.getByText(`Signed in as ${email}`)).toBeVisible();
    await store.getByLabel('Full name').fill('Storefront E2E Buyer');
    await store.getByLabel('Phone number').fill('9812345678');
    await store.getByRole('button', { name: 'Place COD order' }).click();

    await expect(store).toHaveURL(/\/order\/[0-9a-f-]+$/);
    await expect(store.getByRole('heading', { name: /^ORD-/ })).toBeVisible();
    await expect(store.getByRole('paragraph').filter({ hasText: /^Placed$/ })).toBeVisible();

    // The same real order is immediately actionable by tenant staff.
    await page.goto('/online-orders');
    const orderCard = page.locator('article').filter({ hasText: email });
    await expect(orderCard).toBeVisible();
    await orderCard.getByRole('button', { name: 'Prepare in POS' }).click();
    await expect(orderCard.getByRole('button', { name: 'Open held bill' })).toBeVisible();
    await orderCard.getByRole('button', { name: 'Open held bill' }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByText(/Plain T-Shirt/).first()).toBeVisible();
  } finally {
    await shopper.close();
  }
});
