import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** /login — phone + password against the host tenant. */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    // Pin UI language to English (login tests bypass the auth fixture).
    await this.page.addInitScript(() => localStorage.setItem('dokan-lang', 'en'));
    await this.page.goto('/login');
  }

  async signIn(phone: string, password: string) {
    await this.page.getByLabel('Phone', { exact: true }).fill(phone);
    await this.page.getByLabel('Password', { exact: true }).fill(password);
    await this.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }

  async expectSignedIn() {
    // Successful login navigates off /login to the dashboard.
    await expect(this.page).toHaveURL(/\/$/);
  }

  async expectError() {
    await expect(this.page.getByRole('alert')).toBeVisible();
  }
}
