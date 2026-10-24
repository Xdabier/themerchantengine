import type { Page } from '@playwright/test';
import { test, expect } from './_auth-fixture';

/**
 * Plan E / Phase E0 — dialog + drawer chrome (finding E2).
 *
 * Every dialog open site passes `backdropClass: 'cdk-overlay-backdrop-brand'`,
 * but the class had no CSS rule, so the backdrop element rendered fully
 * transparent: a modal did not read as modal. The variant drawer additionally
 * used `panelClass: 'drawer-panel'`, another class with no definition, so the
 * CDK pane fell back to a centered global position while the component root
 * was `h-screen`.
 *
 * Live backend. No `page.route()`, no fixtures.
 */

// Stable seeded product ID from prisma/seed.ts — deterministic across re-runs.
const STABLE_PRODUCT_ID = 'prod-backpack';

/** Parse a computed `background-color` into its alpha channel (0 when unset). */
function alphaOf(color: string): number {
  if (!color || color === 'transparent') return 0;
  const rgba = color.match(/rgba?\(([^)]+)\)/);
  if (!rgba) return 1;
  const parts = rgba[1].split(',').map((p) => Number(p.trim()));
  return parts.length < 4 ? 1 : parts[3];
}

async function backdropAlpha(page: Page): Promise<number> {
  const backdrop = page.locator('.cdk-overlay-backdrop.cdk-overlay-backdrop-brand').last();
  await expect(backdrop).toBeVisible({ timeout: 10_000 });
  const color = await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor);
  return alphaOf(color);
}

test('the bulk-price dialog dims the page behind it', async ({ page }) => {
  await page.goto(`/products?search=backpack`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible({ timeout: 10_000 });

  await page
    .locator(`[data-testid="product-row-checkbox-${STABLE_PRODUCT_ID}"] input[type="checkbox"]`)
    .first()
    .check();
  await page.locator('[data-testid="products-bulk-bar-prices"] button').click();
  await expect(page.locator('[data-testid="bulk-prices-dialog"]')).toBeVisible({ timeout: 10_000 });

  expect(
    await backdropAlpha(page),
    'the CDK backdrop is fully transparent — .cdk-overlay-backdrop-brand has no background rule',
  ).toBeGreaterThan(0);

  await page.screenshot({ path: '.e2e-review/journey-dialog-scrim.png', fullPage: true });
});

test('the variant drawer is a full-height right side panel over a scrim', async ({ page }) => {
  await page.goto(`/products/${STABLE_PRODUCT_ID}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('tab', { name: 'Variants' }).click();
  await expect(page.locator('[data-testid="product-editor-variants"]')).toBeVisible();

  await page.locator('[data-testid="product-variant-add"]').click();
  await expect(page.locator('[data-testid="variant-dialog"]')).toBeVisible({ timeout: 10_000 });

  expect(await backdropAlpha(page)).toBeGreaterThan(0);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const pane = page.locator('.cdk-overlay-pane.side-panel-right');
  await expect(pane).toBeVisible();
  const box = await pane.boundingBox();
  expect(box).not.toBeNull();

  // Full viewport height, flush against the inline-end edge.
  expect(Math.abs(box!.height - viewport!.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(box!.x + box!.width - viewport!.width)).toBeLessThanOrEqual(2);

  await page.screenshot({ path: '.e2e-review/journey-variant-drawer.png', fullPage: true });
  await page.locator('[data-testid="variant-dialog-close"]').click();
  await expect(page.locator('[data-testid="variant-dialog"]')).toHaveCount(0);
});
