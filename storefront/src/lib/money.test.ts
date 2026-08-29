import { describe, expect, it } from 'vitest';

import type { StoreContent } from './api';
import { formatPriceRange, offerLabel, productPriceDisplay } from './money';

describe('formatPriceRange', () => {
  it('returns "Price on request" when both bounds are null', () => {
    expect(formatPriceRange(null, null, 'NPR')).toBe('Price on request');
    expect(formatPriceRange(null, null, 'INR')).toBe('Price on request');
  });

  it('renders a single amount when only one bound is set', () => {
    expect(formatPriceRange('800.00', null, 'NPR')).toBe('Rs 800');
    expect(formatPriceRange(null, '1600.00', 'NPR')).toBe('Rs 1,600');
  });

  it('collapses equal bounds to a single amount', () => {
    expect(formatPriceRange('1200.00', '1200.00', 'NPR')).toBe('Rs 1,200');
    expect(formatPriceRange('999', '999', 'INR')).toBe('₹999');
  });

  it('renders a range with the prefix once and an en dash', () => {
    expect(formatPriceRange('800.00', '1600.00', 'NPR')).toBe('Rs 800 – 1,600');
    expect(formatPriceRange('1500', '4999', 'INR')).toBe('₹1,500 – 4,999');
  });

  it('uses en-IN (lakh) grouping for large amounts', () => {
    expect(formatPriceRange('125000', null, 'NPR')).toBe('Rs 1,25,000');
    expect(formatPriceRange('1000000', '2500000', 'INR')).toBe('₹10,00,000 – 25,00,000');
  });

  it('keeps paise when the amount is not a round number', () => {
    expect(formatPriceRange('99.50', null, 'NPR')).toBe('Rs 99.5');
  });

  it('orders the range ascending even if the bounds arrive swapped', () => {
    expect(formatPriceRange('1600.00', '800.00', 'NPR')).toBe('Rs 800 – 1,600');
  });

  it('treats unparseable values as missing', () => {
    expect(formatPriceRange('not-a-price', null, 'NPR')).toBe('Price on request');
  });
});

describe('productPriceDisplay', () => {
  const ranged = {
    price_min: '800.00',
    price_max: '1600.00',
    website_price: null,
    website_compare_at: null,
  };

  it('falls back to the selling-price range without a website price', () => {
    expect(productPriceDisplay(ranged, 'NPR')).toEqual({
      text: 'Rs 800 – 1,600',
      compareAt: null,
    });
  });

  it('shows the website price as a single amount when set', () => {
    expect(
      productPriceDisplay({ ...ranged, website_price: '1200.00' }, 'NPR'),
    ).toEqual({ text: 'Rs 1,200', compareAt: null });
  });

  it('exposes the compare-at price while an offer runs', () => {
    expect(
      productPriceDisplay(
        { ...ranged, website_price: '900.00', website_compare_at: '1200.00' },
        'INR',
      ),
    ).toEqual({ text: '₹900', compareAt: '₹1,200' });
  });
});

describe('offerLabel', () => {
  const base: StoreContent = {
    hero_title: '',
    hero_subtitle: '',
    announcement: '',
    offer_text: '',
    offer_discount_pct: null,
  };

  it('is null when nothing is configured', () => {
    expect(offerLabel(base)).toBeNull();
  });

  it('joins the offer text and a whole-number percentage', () => {
    expect(offerLabel({ ...base, offer_text: 'Dashain Sale', offer_discount_pct: '25.00' })).toBe(
      'Dashain Sale · 25% off',
    );
  });

  it('keeps fractional percentages and works without text', () => {
    expect(offerLabel({ ...base, offer_discount_pct: '12.50' })).toBe('12.5% off');
  });
});
