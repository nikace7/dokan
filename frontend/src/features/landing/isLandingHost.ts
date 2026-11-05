/**
 * The bare domain and the reserved `www`/`app` hosts have no shop behind them
 * (TenantMiddleware gives them tenant=None), so a login form can never work
 * there. They show the public landing page instead.
 *
 * Bare `localhost` stays a shop host: the Vite proxy maps it to the demo tenant.
 *
 * ponytail: a two-label check, so a root domain like dokan.com.np counts as a
 * shop and keeps showing login. Pass ROOT_DOMAIN to the build if one is used.
 */
export function isLandingHost(hostname = window.location.hostname): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (/^(www|app)\./.test(host)) {
    return true;
  }
  const labels = host.split('.');
  return labels.length === 2 && labels[1] !== 'localhost' && !/^\d+$/.test(labels[1]);
}
