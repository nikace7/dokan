import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isLandingHost } from './isLandingHost';
import { LandingPage } from './LandingPage';

describe('isLandingHost', () => {
  it.each(['mero-pasal.online', 'www.mero-pasal.online', 'app.mero-pasal.online', 'www.localhost'])(
    'treats %s as a landing host',
    (host) => {
      expect(isLandingHost(host)).toBe(true);
    },
  );

  it.each([
    'rangoli.mero-pasal.online',
    'demo.localhost',
    'localhost',
    'admin.mero-pasal.online',
    '127.0.0.1',
  ])('keeps %s as an app host', (host) => {
    expect(isLandingHost(host)).toBe(false);
  });
});

describe('LandingPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes no compliance claim', () => {
    render(<LandingPage />);

    expect(document.body.textContent).not.toMatch(/IRD[- ]compliant/i);
    expect(screen.getByText(/not IRD-approved billing software yet/i)).toBeInTheDocument();
  });

  it('labels the sample shop and runs a sale without any network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LandingPage />);

    expect(screen.getByText('Sample shop. Made-up data.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    expect(screen.getByRole('status')).toHaveTextContent('Sample bill 1');
    expect(screen.getByText('9 left in stock')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks a price outside the allowed range', () => {
    render(<LandingPage />);

    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '100' } });

    expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled();
  });
});
