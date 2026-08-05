import { test as base } from '@playwright/test';

import { DemoApi } from './helpers/api';

/**
 * Authenticated-test fixture.
 *
 * - `api`: a logged-in DemoApi client for setup/teardown calls.
 * - `page`: tokens seeded into localStorage (the same keys the SPA's
 *   lib/auth/tokens.ts uses) before any app script runs, so tests start
 *   signed in without driving the login form. The login form itself is
 *   covered by tests/login.spec.ts, which intentionally does NOT use this
 *   fixture.
 */
interface Fixtures {
  api: DemoApi;
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = new DemoApi();
    await api.login();
    await use(api);
  },
  page: async ({ page, api }, use) => {
    await page.addInitScript(
      ([access, refresh]) => {
        localStorage.setItem('dokan.access', access);
        localStorage.setItem('dokan.refresh', refresh);
      },
      [api.accessToken, api.refreshToken],
    );
    await use(page);
  },
});

export { expect } from '@playwright/test';
