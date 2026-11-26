import i18n from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';
import { auditActionLabel, permissionName } from '@/lib/codeLabels';

const error = (code: string, message: string) => new ApiError(400, { code, message });

describe('server codes in the shop language', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('keeps the server English, and translates by code in Nepali', async () => {
    expect(error('QTY_INVALID', 'Sale quantity must be greater than zero.').message).toBe(
      'Sale quantity must be greater than zero.',
    );

    await i18n.changeLanguage('ne');
    expect(error('QTY_INVALID', 'Sale quantity must be greater than zero.').message).toBe(
      'मात्रा शून्यभन्दा बढी हुनुपर्छ।',
    );
    expect(error('STOCK_INSUFFICIENT', 'Only 2 of TS-M in stock.').message).toContain(
      'Only 2 of TS-M in stock.',
    );
    expect(error('SOMETHING_NEW', 'Server text.').message).toBe('Server text.');
  });

  it('names permissions and audit actions', async () => {
    expect(permissionName('sale.create', 'Create bills')).toBe('Create bills');
    expect(auditActionLabel('sale.share')).toBe('Bill shared');
    expect(auditActionLabel('new.thing')).toBe('new.thing');

    await i18n.changeLanguage('ne');
    expect(permissionName('sale.create', 'Create bills')).toBe('बिल बनाउने');
    expect(auditActionLabel('sale.share')).toBe('बिल सेयर');
  });
});
