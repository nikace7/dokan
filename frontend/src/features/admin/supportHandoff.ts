interface LocationParts {
  protocol: string;
  hostname: string;
  port: string;
}

export function isPlatformHost(hostname = window.location.hostname): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'admin.localhost' || normalized.startsWith('admin.');
}

export function buildSupportHandoffUrl(
  slug: string,
  access: string,
  location: LocationParts = window.location,
): string {
  const root = location.hostname.startsWith('admin.')
    ? location.hostname.slice('admin.'.length)
    : location.hostname;
  const port = location.port ? `:${location.port}` : '';
  return `${location.protocol}//${slug}.${root}${port}/support-login#access=${encodeURIComponent(access)}`;
}
