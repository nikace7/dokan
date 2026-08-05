import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** /login — phone + password against the host tenant. */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async signIn(phone: string, password: string) {
    await this.page.getByLabel('Phone / फोन').fill(phone);
    await this.page.getByLabel('Password / पासवर्ड').fill(password);
    await this.page.getByRole('button', { name: 'Sign in / प्रवेश' }).click();
  }

  async expectSignedIn() {
    // Successful login navigates off /login to the dashboard.
    await expect(this.page).toHaveURL(/\/$/);
  }

  async expectError() {
    await expect(this.page.getByRole('alert')).toBeVisible();
  }
}
