import { expect, test } from '@playwright/test';

import { settleLayout } from './settle-layout';

/**
 * Canary for the settle step the visual specs run before a full-page capture.
 *
 * The settings pages render a skeleton, fetch, then swap in a taller form. A
 * fixed 300 ms wait can land on either side of that swap, so two consecutive
 * full-page captures disagree on height and `toHaveScreenshot` gives up. This
 * page reproduces the swap with a late timer.
 */
const LATE_SWAP_PAGE = `
  <main data-testid="app-shell-main">
    <div id="slot"><app-skeleton style="display:block;height:200px"></app-skeleton></div>
  </main>
  <script>
    setTimeout(() => {
      document.getElementById('slot').innerHTML = '<form style="display:block;height:2400px"></form>';
    }, 800);
  </script>
`;

const scrollHeight = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollHeight);

test.describe('settleLayout', () => {
  test('a fixed 300 ms wait captures the page before the skeleton swap', async ({ page }) => {
    await page.setContent(LATE_SWAP_PAGE);
    await page.waitForTimeout(300);
    expect(await scrollHeight(page)).toBeLessThan(2400);
  });

  test('waits for the skeleton swap and a stable height', async ({ page }) => {
    await page.setContent(LATE_SWAP_PAGE);
    await settleLayout(page);
    expect(await page.locator('app-skeleton').count()).toBe(0);
    expect(await scrollHeight(page)).toBeGreaterThanOrEqual(2400);
  });
});
