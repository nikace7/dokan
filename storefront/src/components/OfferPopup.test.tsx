import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OfferPopup } from './OfferPopup';
import type { StorePopup } from '../lib/api';

const POPUP: StorePopup = {
  title: 'Dashain Offer',
  text: '20% off everything this week',
  cta_text: 'Shop now',
  cta_link: '#shop',
};

function renderPopup(popup: StorePopup | null) {
  return render(
    <OfferPopup
      popup={popup}
      backdropClassName="backdrop"
      panelClassName="panel"
    >
      {(close) => (
        <div>
          <h2>{popup?.title}</h2>
          <p>{popup?.text}</p>
          <a href={popup?.cta_link} onClick={close}>
            {popup?.cta_text}
          </a>
        </div>
      )}
    </OfferPopup>,
  );
}

describe('OfferPopup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never renders without a popup', () => {
    renderPopup(null);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens after a beat, once per session', () => {
    renderPopup(POPUP);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1300));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dashain Offer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '#shop');

    // Closing marks it seen — a remount in the same session stays quiet.
    fireEvent.click(screen.getByRole('link', { name: 'Shop now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    renderPopup(POPUP);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('re-appears when the shop edits the copy', () => {
    renderPopup(POPUP);
    act(() => vi.advanceTimersByTime(1300));
    fireEvent.click(screen.getByRole('link', { name: 'Shop now' }));

    renderPopup({ ...POPUP, text: 'Now 30% off' });
    act(() => vi.advanceTimersByTime(1300));
    expect(screen.getByText('Now 30% off')).toBeInTheDocument();
  });
});
