import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  STOREFRONT_LOCALES,
  attachConsoleBaseline,
  directionOf,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S1 — services-stack smoke.
 *
 * Boots against the real API on `STOREFRONT_E2E_API_URL` (defaults to
 * `http://localhost:53001/api`). The smoke page at
 * `/<locale>/_smoke/services` calls `ProductsService.list({page:1, pageSize:5})`
 * through the real `libs/storefront-services` binding and renders the parsed
 * payload as JSON in `<pre data-testid="services-smoke-payload">`.
 *
 * Per `agent_docs/storefront/testing-strategy.md` the spec asserts
 * shape, not row count — empty `data` is acceptable here because the fixture catalogue
 * seed only lands in S2.
 *
 * No `page.route()` and no fixtures — constitution §3.8.
 */

const PAYLOAD = '[data-testid="services-smoke-payload"]';
const STATUS = '[data-testid="services-smoke-status"]';

async function readSmokePayload(page: import('@playwright/test').Page): Promise<unknown> {
  // Wait for the smoke component to flip out of `pending`.
  const status = page.locator(STATUS);
  await expect(status).not.toHaveText(/loading/i, { timeout: 30_000 });

  const payloadEl = page.locator(PAYLOAD);
  await expect(payloadEl).toHaveAttribute('data-state', /ready|error/, { timeout: 30_000 });
  const text = await payloadEl.textContent();
  if (!text || text.trim().length === 0) {
    throw new Error('services-smoke-payload was empty');
  }
  return JSON.parse(text);
}

test.describe('storefront S1 services smoke', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('French smoke route fetches products through the real services lib', async ({ page }) => {
    await page.goto('/fr/_smoke/services');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'fr');
    // The direction comes from the active fixture: this is the tripwire for a
    // page that renders a locale in the wrong writing direction.
    await expect(html).toHaveAttribute('dir', directionOf('fr'));

    const payload = (await readSmokePayload(page)) as {
      data?: unknown[];
      meta?: { page?: number; pageSize?: number; total?: number };
    };

    expect(payload).toBeTruthy();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.meta).toBeTruthy();
    expect(typeof payload.meta?.page).toBe('number');
    expect(typeof payload.meta?.pageSize).toBe('number');
    expect(typeof payload.meta?.total).toBe('number');
  });

  test('English smoke route fetches products through the real services lib', async ({ page }) => {
    await page.goto('/en/_smoke/services');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', directionOf('en'));

    const payload = (await readSmokePayload(page)) as {
      data?: unknown[];
      meta?: { page?: number; pageSize?: number; total?: number };
    };

    expect(payload).toBeTruthy();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.meta).toBeTruthy();
  });

  test('axe — zero violations on the smoke page in every served locale', async ({ page }) => {
    for (const locale of STOREFRONT_LOCALES) {
      await page.goto(`/${locale}/_smoke/services`);
      // Wait for the smoke payload so the page tree is settled before axe runs.
      const payloadEl = page.locator(PAYLOAD);
      await expect(payloadEl).toHaveAttribute('data-state', /ready|error/, { timeout: 30_000 });
      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: false,
        includedImpacts: ['serious', 'critical'],
        axeOptions: {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
        },
      });
    }
  });
});
