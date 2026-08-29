import { describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATE, TEMPLATES, resolveTemplate } from './index';

describe('template registry', () => {
  it('registers the aurora and bazaar templates', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(['aurora', 'bazaar']);
    expect(typeof TEMPLATES.aurora).toBe('function');
    expect(typeof TEMPLATES.bazaar).toBe('function');
  });

  it('has aurora as the default template', () => {
    expect(DEFAULT_TEMPLATE).toBe('aurora');
    expect(TEMPLATES[DEFAULT_TEMPLATE]).toBe(TEMPLATES.aurora);
  });

  it('falls back to the default for unknown template keys', () => {
    expect(resolveTemplate('aurora')).toBe(TEMPLATES.aurora);
    expect(resolveTemplate('bazaar')).toBe(TEMPLATES.bazaar);
    expect(resolveTemplate('does-not-exist')).toBe(TEMPLATES[DEFAULT_TEMPLATE]);
    expect(resolveTemplate('')).toBe(TEMPLATES[DEFAULT_TEMPLATE]);
  });
});
