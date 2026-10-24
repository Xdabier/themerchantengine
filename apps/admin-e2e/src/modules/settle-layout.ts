import { expect, type Page } from '@playwright/test';

const STABLE_FRAMES = 10;

/**
 * Waits until a page is ready for a full-page screenshot: no loading skeleton
 * left and the document height unchanged for several animation frames. A fixed
 * timeout could land before the skeleton swap, so two captures disagreed on
 * height and `toHaveScreenshot` failed as unstable.
 */
export async function settleLayout(page: Page): Promise<void> {
  await expect(page.locator('app-skeleton')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let last = document.documentElement.scrollHeight;
        let steady = 0;
        const tick = () => {
          const height = document.documentElement.scrollHeight;
          steady = height === last ? steady + 1 : 0;
          last = height;
          if (steady >= frames) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    STABLE_FRAMES,
  );
}
