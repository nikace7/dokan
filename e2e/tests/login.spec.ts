import { expect, test } from '@playwright/test';

import { config } from '../config';
import { BillingPage } from '../pages/BillingPage';
import { LoginPage } from '../pages/LoginPage';

// Raw UI login — no auth fixture on purpose.
test.describe('login', () => {
  test('signs in with the seeded demo owner and reaches the dashboard', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn(config.phone, config.password);
    await login.expectSignedIn();
  });

  test('rejects a wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn(config.phone, 'wrong-password');
    await login.expectError();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('billing screen loads after login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn(config.phone, config.password);
    await login.expectSignedIn();

    const billing = new BillingPage(page);
    await billing.goto();
    await expect(page.getByRole('heading', { name: 'Payment / भुक्तानी' })).toBeVisible();
  });
});
