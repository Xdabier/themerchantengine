import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  activeStoreConfigFixture,
  attachConsoleBaseline,
  describeEveryLocale,
  expectedDocumentNotFound,
  type ConsoleBaseline,
} from './support';

/** The locale an unsupported segment 301s onto, read from the active fixture. */
const DEFAULT_LOCALE = activeStoreConfigFixture().localization.defaultLocale;

/**
 * Phase S15 — error pages + about + policies journey.
 *
 * Locale-agnostic /404 + /500: bilingual stacked content, noindex meta,
 * brand-voiced CTAs.
 *
 * Locale-aware /{locale}/error: same-origin `from=` retry sanitizer.
 *
 * /{locale}/about + /{locale}/policies/{slug}: SSG pages — heading,
 * meta description, og:url scoped to locale + path.
 *
 * Boots against the real test API + fixture catalogue seed (no fixtures, no
 * `page.route()` per constitution §3.8). Axe sweep at every render step.
 */

const POLICY_SLUGS = ['privacy', 'returns', 'terms', 'shipping'] as const;

test.describe('storefront S15 error pages + static SSG', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  //
  // The /404, /500, /{locale}/error surfaces are SSR-rendered with the
  // matching HTTP status but the body is a normal brand-voiced page —
  // no network fetch follows, no JS-throws. The unsupported-locale 301 and
  // the /policies/unknown-slug redirect also resolve to clean rendered
  // pages. If a CI run surfaces a known-noise pattern here (e.g., a
  // framework warning on the /500 surface), allowlist it via
  // `baseline.assertClean({ ignore: [/<pattern>/] })` in the relevant
  // afterEach and document the pattern with a code comment that cites
  // the framework version or test path producing it.
  let baseline: ConsoleBaseline;
  let currentPage: Page;
  test.beforeEach(({ page }) => {
    currentPage = page;
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    // One thing is allowed through: the browser's own log line for a document
    // that answered 404. Several routes here are deliberately unknown, and a
    // real 404 is what the storefront now returns for them instead of a 200
    // with an empty body. The predicate matches on the resource URL being the
    // document itself, not on the message text, so a 404 on an image or an API
    // call still fails the run.
    baseline.assertClean({ ignore: [expectedDocumentNotFound(currentPage)] });
  });

  test.describe('locale-agnostic /404', () => {
    test('renders bilingual content + noindex robots meta', async ({ page }) => {
      const response = await page.goto('/404');
      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator('#not-found-heading-fr')).toHaveText('Page introuvable');
      await expect(page.locator('#not-found-heading-en')).toHaveText('Page not found');
      await expect(page.locator('a.cta')).toHaveCount(2);
      const robots = page.locator('meta[name="robots"]');
      await expect(robots).toHaveAttribute('content', 'noindex, nofollow');
      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: true,
        axeOptions: { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
    });
  });

  test.describe('locale-agnostic /500', () => {
    test('renders bilingual content + noindex robots meta', async ({ page }) => {
      const response = await page.goto('/500');
      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator('#server-error-heading-fr')).toHaveText(
        'Une erreur est survenue de notre côté',
      );
      await expect(page.locator('#server-error-heading-en')).toHaveText(
        'Something went wrong on our end',
      );
      const robots = page.locator('meta[name="robots"]');
      await expect(robots).toHaveAttribute('content', 'noindex, nofollow');
      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: true,
        axeOptions: { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
    });
  });

  test.describe('unsupported locale segment', () => {
    // The Nitro locale-redirect middleware 301s any first segment shaped like a
    // language tag but absent from the supported set onto the default locale,
    // keeping the rest of the path. The browser therefore lands on the
    // locale-SCOPED not-found surface, not the bilingual root /404 page.
    //
    // `de` is a real language code the locale registry does not carry, and no
    // fixture serves it, so a single 301 proves it resolves nowhere.
    //
    // This array is an invalid-locale probe list, NOT a locale matrix: every
    // value in it is deliberately unsupported, so `describeEveryLocale` (which
    // yields the served locales) does not apply here. Constitution §3.11 rule 4
    // governs the served locales only.
    for (const unsupported of ['zz', 'de'] as const) {
      test(`/${unsupported}/foo lands on the default locale not-found surface`, async ({
        page,
      }) => {
        const response = await page.goto(`/${unsupported}/foo`);
        expect(response?.status()).toBeLessThan(500);
        await expect(page).toHaveURL(new RegExp(`/${DEFAULT_LOCALE}/foo$`));
        // The locale-scoped page, proven by the id: the locale-agnostic root
        // page carries `#not-found-heading-fr` + `#not-found-heading-en`
        // instead, so asserting one and denying the other pins which surface
        // rendered.
        await expect(page.locator('#not-found-heading')).toBeVisible();
        await expect(page.locator(`#not-found-heading-${DEFAULT_LOCALE}`)).toHaveCount(0);
        const robots = page.locator('meta[name="robots"]');
        await expect(robots).toHaveAttribute('content', /noindex/);
      });
    }
  });

  test.describe('locale-aware /{locale}/error', () => {
    test('renders home CTA + retry CTA pointing at safe same-origin from', async ({ page }) => {
      const response = await page.goto('/en/error?from=/en/catalog');
      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator('#error-heading')).toHaveText('Something went wrong on our end');
      const retry = page.locator('a.cta.primary');
      await expect(retry).toBeVisible();
      const retryHref = await retry.getAttribute('href');
      expect(retryHref).toBe('/en/catalog');
      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: true,
        axeOptions: { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
    });

    test('rejects a cross-origin from value and falls back to home only', async ({ page }) => {
      await page.goto('/fr/error?from=https://evil.example/foo');
      await expect(page.locator('a.cta.primary')).toHaveCount(0);
      await expect(page.locator('a.cta.secondary')).toBeVisible();
    });

    test('rejects a javascript: scheme from value', async ({ page }) => {
      await page.goto('/en/error?from=javascript:alert(1)');
      await expect(page.locator('a.cta.primary')).toHaveCount(0);
    });
  });

  describeEveryLocale('about page', (locale) => {
    test(`renders the brand-voiced about page at /${locale}/about with SEO surface`, async ({
      page,
    }) => {
      const response = await page.goto(`/${locale}/about`);
      expect(response?.ok()).toBeTruthy();
      await expect(page.locator('#about-heading')).toBeVisible();
      const description = page.locator('meta[name="description"]');
      await expect(description).toHaveAttribute('content', /.+/);
      const desc = await description.getAttribute('content');
      expect(desc?.length).toBeGreaterThan(0);
      expect(desc!.length).toBeLessThanOrEqual(200);
      const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
      expect(ogUrl).toContain(`/${locale}/about`);
      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: true,
        axeOptions: { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
    });
  });

  test.describe('policy pages', () => {
    describeEveryLocale('slug rendering', (locale) => {
      for (const slug of POLICY_SLUGS) {
        test(`renders /${locale}/policies/${slug} with brand-voiced copy`, async ({ page }) => {
          const response = await page.goto(`/${locale}/policies/${slug}`);
          expect(response?.ok()).toBeTruthy();
          await expect(page.locator('#policy-heading')).toBeVisible();
          const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
          expect(ogUrl).toContain(`/${locale}/policies/${slug}`);
        });
      }
    });

    test('an unknown slug answers 404 with the locale not-found page', async ({ page }) => {
      // This test described a client-side redirect that was deleted in May
      // 2026 when the allowlist moved into the `.server.ts`. What it asserted
      // stayed correct; what its comment said stopped being true, and it has
      // been red ever since because the loader 404 rejects Analog's route
      // resolver rather than rendering the wildcard. Full contract, across
      // policies, category and product, lives in `loader-404.journey.spec.ts`.
      const response = await page.goto('/en/policies/unknown-slug');
      expect(response?.status(), 'a 200 here is a soft 404').toBe(404);
      await expect(page.locator('#not-found-heading')).toHaveText('Page not found');
      await expect(page.locator('#policy-heading')).toHaveCount(0);
      // The empty-shell assertion: everything above passed on a page that
      // rendered no route component at all.
      expect(await page.locator('main > *').count()).toBeGreaterThan(0);
    });
  });

  describeEveryLocale('footer links resolve to the SSG slugs', (locale) => {
    // The routerLink → SPA-navigate click flow is unit-tested in
    // `apps/storefront/src/app/layout/footer.component.spec.ts` (asserts
    // each anchor's `href` attribute resolves to the correct
    // `APP_ROUTES.about` / `APP_ROUTES.policy(...)` path, in both
    // locales). The page-rendering side is covered by the direct-goto
    // tests above. Here we add an integration probe that the rendered
    // footer carries the expected hrefs so a future regression in either
    // half is caught at the e2e seam, regardless of UA — without
    // re-creating a click test that races against UA-specific hydration.
    test(`/${locale}/ footer carries hrefs for about + every policy slug`, async ({ page }) => {
      await page.goto(`/${locale}/`);
      await expect(page.locator('[data-testid="footer-link-about"]')).toHaveAttribute(
        'href',
        `/${locale}/about`,
      );
      for (const slug of POLICY_SLUGS) {
        await expect(page.locator(`[data-testid="footer-link-${slug}"]`)).toHaveAttribute(
          'href',
          `/${locale}/policies/${slug}`,
        );
      }
    });
  });
});
