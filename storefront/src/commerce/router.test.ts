import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { navigate } from './router';

function mockReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches }) as MediaQueryList),
  );
}

describe('navigate', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses instant scrolling when reduced motion is requested', () => {
    const scrollTo = vi.fn();
    mockReducedMotion(true);
    vi.stubGlobal('scrollTo', scrollTo);

    navigate('/cart');

    expect(window.location.pathname).toBe('/cart');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('keeps smooth navigation when reduced motion is not requested', () => {
    const scrollTo = vi.fn();
    mockReducedMotion(false);
    vi.stubGlobal('scrollTo', scrollTo);

    navigate('/products/example');

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
