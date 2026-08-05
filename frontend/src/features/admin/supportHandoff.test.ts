import { describe, expect, it } from 'vitest';

import { buildSupportHandoffUrl, isPlatformHost } from '@/features/admin/supportHandoff';

describe('admin host and support handoff', () => {
  it('mounts the control plane only on the reserved admin host', () => {
    expect(isPlatformHost('admin.dokan.com.np')).toBe(true);
    expect(isPlatformHost('admin.localhost')).toBe(true);
    expect(isPlatformHost('demo.dokan.com.np')).toBe(false);
  });

  it('puts the short-lived support token in a fragment on the tenant origin', () => {
    const url = buildSupportHandoffUrl('himalayan-fashion', 'tenant.token/value', {
      protocol: 'https:',
      hostname: 'admin.dokan.com.np',
      port: '',
    });

    expect(url).toBe(
      'https://himalayan-fashion.dokan.com.np/support-login#access=tenant.token%2Fvalue',
    );
    expect(url).not.toContain('?');
  });
});
