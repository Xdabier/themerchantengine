import { expect, test } from '@playwright/test';

import { attachConsoleBaseline, describeEveryLocale, type ConsoleBaseline } from './support';

/**
 * Finding N5 — client-side navigation re-hydrates content and meta.
 *
 * Analog forces `runGuardsAndResolvers: 'paramsOrQueryParamsChange'` on every
 * file route, so a sibling-slug navigation re-runs the loader and a fresh
 * payload arrives. The pages that copied that payload into signals once, at
 * field-initialiser time, silently dropped it: the URL changed and the page
 * did not.
 *
 * Policy-to-policy is the cheapest way to drive a real SPA navigation from the
 * suite — the footer links are `routerLink` bindings present on every page, so
 * no fixture and no seeded catalogue shape is needed.
 */
describeEveryLocale('storefront SPA re-hydration (finding N5)', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  async function canonicalHref(page: import('@playwright/test').Page): Promise<string | null> {
    return page.locator('link[rel="canonical"]').first().getAttribute('href');
  }

  test(`policy to policy navigation updates the title and canonical (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/policies/privacy`);
    const firstHeading = (await page.locator('main h1').first().textContent())?.trim() ?? '';
    const firstTitle = await page.title();
    expect(await canonicalHref(page)).toContain('/policies/privacy');

    await page.getByTestId('footer-link-terms').click();
    await page.waitForURL(`**/${locale}/policies/terms`);

    const secondHeading = (await page.locator('main h1').first().textContent())?.trim() ?? '';
    expect(secondHeading).not.toBe(firstHeading);
    // The stale-meta half of the finding: the body always followed the loader,
    // the tab title and the canonical did not.
    await expect.poll(async () => page.title(), { timeout: 10000 }).not.toBe(firstTitle);
    expect(await page.title()).toContain(secondHeading);
    await expect
      .poll(async () => canonicalHref(page), { timeout: 10000 })
      .toContain('/policies/terms');
  });

  test(`policy JSON-LD is re-emitted for the destination page (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/policies/privacy`);
    await page.getByTestId('footer-link-shipping').click();
    await page.waitForURL(`**/${locale}/policies/shipping`);

    await expect
      .poll(
        async () => page.locator('script[type="application/ld+json"][data-policy-jsonld]').count(),
        { timeout: 10000 },
      )
      .toBe(1);
    const payload = await page
      .locator('script[type="application/ld+json"][data-policy-jsonld]')
      .first()
      .textContent();
    expect(payload).toContain('/policies/shipping');
    expect(payload).not.toContain('/policies/privacy');
  });

  test(`returning to the first policy restores its own meta (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/policies/privacy`);
    const privacyTitle = await page.title();

    await page.getByTestId('footer-link-terms').click();
    await page.waitForURL(`**/${locale}/policies/terms`);
    await page.getByTestId('footer-link-privacy').click();
    await page.waitForURL(`**/${locale}/policies/privacy`);

    await expect.poll(async () => page.title(), { timeout: 10000 }).toBe(privacyTitle);
    await expect
      .poll(async () => canonicalHref(page), { timeout: 10000 })
      .toContain('/policies/privacy');
  });
});
