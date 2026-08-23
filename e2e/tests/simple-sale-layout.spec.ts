import { expect, test } from '../fixtures';

// Seeded demo catalog (seed_demo): JW-01 Denim Jacket, M/L Black, in stock.
const JACKET_TILE = /Denim Jacket/;

/**
 * Layout regression coverage for /billing/simple:
 * - the quick-pick photo grid renders in-stock items and tap-adds lines;
 * - the fixed Cash/QR tender bar stays rigid at the viewport bottom while
 *   scrolling (desktop flush, mobile riding above the h-14 tab bar).
 *
 * Small viewport heights force the page to scroll with only the seeded
 * catalog on hand. Screenshots land in test-results/layout/ for review.
 */
test.describe('simple sale layout', () => {
  test('quick-pick grid lists in-stock items; tapping a tile adds a line', async ({ page }) => {
    await page.goto('/billing/simple');

    const grid = page.getByRole('region', { name: 'Quick pick' });
    await expect(grid).toBeVisible();
    const tile = grid.getByRole('button', { name: JACKET_TILE }).first();
    await expect(tile).toBeVisible();
    await tile.click();

    // The line appears without the search dialog ever opening.
    await expect(page.getByRole('region', { name: /Denim Jacket — (L|M) \/ Black/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('tender bar stays pinned to the viewport bottom while scrolling (desktop)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 460 });
    await page.goto('/billing/simple');
    const bar = page.getByTestId('tender-bar');
    await expect(bar).toBeVisible();

    // Add a line so the page has content above the grid.
    await page
      .getByRole('region', { name: 'Quick pick' })
      .getByRole('button', { name: JACKET_TILE })
      .first()
      .click();

    const assertPinned = async () => {
      const box = await bar.boundingBox();
      expect(box).not.toBeNull();
      // Desktop: no bottom tab bar — the bar sits flush with the viewport.
      expect(Math.abs(box!.y + box!.height - 460)).toBeLessThanOrEqual(3);
    };

    await page.evaluate(() => window.scrollTo(0, 0));
    await assertPinned();
    await page.screenshot({ path: 'test-results/layout/desktop-top.png' });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await assertPinned();
    await page.screenshot({ path: 'test-results/layout/desktop-scrolled.png' });
  });

  test('tender bar rides above the tab bar while scrolling (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto('/billing/simple');
    const bar = page.getByTestId('tender-bar');
    await expect(bar).toBeVisible();

    const assertPinnedAboveTabBar = async () => {
      const box = await bar.boundingBox();
      expect(box).not.toBeNull();
      // Mobile: the bar's bottom edge rests on the h-14 (56px) tab bar.
      expect(Math.abs(box!.y + box!.height - (700 - 56))).toBeLessThanOrEqual(3);
    };

    await page.evaluate(() => window.scrollTo(0, 0));
    await assertPinnedAboveTabBar();
    await page.screenshot({ path: 'test-results/layout/mobile-top.png' });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await assertPinnedAboveTabBar();
    await page.screenshot({ path: 'test-results/layout/mobile-scrolled.png' });
  });
});
