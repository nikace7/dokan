import { defineConfig } from '@playwright/test';

import { config } from './config';

// The compose stack serves tenants from subdomains (demo.localhost). On
// Windows, *.localhost resolves to ::1 where the Docker port proxy does not
// listen, so force the tenant host onto IPv4 loopback for the browser. This
// is a no-op for setups where the hostname already resolves correctly, and
// harmless for the Vite dev server (localhost -> 127.0.0.1).
const hostResolverRules = `--host-resolver-rules=MAP ${config.tenantHost} 127.0.0.1, MAP ${config.storefrontHost} 127.0.0.1, MAP localhost 127.0.0.1`;

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // One worker: the suite shares a single demo tenant (stock levels, cash
  // session, invoice numbering) — parallel browsers would race it.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: config.baseURL,
    // Caddy's local edge uses its internal CA (CADDY_TLS_CONFIG=tls-local).
    ignoreHTTPSErrors: true,
    launchOptions: { args: [hostResolverRules] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
