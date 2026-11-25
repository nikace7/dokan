import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Read from disk: Vitest hands back an empty string for imported stylesheets.
const css = readFileSync('src/styles/index.css', 'utf8');
const print = css.slice(css.indexOf('@media print'));

describe('print styles', () => {
  // Any of these on its own prints every other page as a blank 80mm slip.
  it('apply the 80mm receipt layout only to a page with a receipt', () => {
    expect(print).not.toMatch(/@page *[{]/);
    const rules = print.match(/^ {2}[^@ }/][^{]*[{]/gm) ?? [];
    expect(rules.length).toBeGreaterThan(10);
    const unscoped = rules.filter((rule) =>
      rule
        .split(',')
        .some((selector) => !/#sales-receipt|[[]data-report-print|receipt-/.test(selector)),
    );
    expect(unscoped).toEqual([]);
  });
});
