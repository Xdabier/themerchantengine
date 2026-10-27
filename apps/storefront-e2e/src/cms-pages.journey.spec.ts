import { expect, test, type Page } from '@playwright/test';

import {
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  expectedDocumentNotFound,
  type ConsoleBaseline,
  activeStoreConfigFixture,
  type StorefrontLocale,
  waitForHydration,
} from './support';

/**
 * The generic CMS page route, `/{locale}/pages/{slug}`.
 *
 * A page published in the admin used to have no storefront surface at all:
 * only `/about` and the four `/policies/*` slugs were routed, so the two other
 * seeded published pages (`/contact`, `/faq`) 404'd at every URL a customer
 * could try, while the pages sitemap advertised them anyway.
 *
 * Assertions are positive and conjunctive on purpose. "Does not 404" would
 * pass on the empty layout shell the loader-404 spec was written to catch, so
 * every happy-path test names the heading text it expects and proves `<main>`
 * has a child.
 */

/** Seeded by `prisma/seed.ts`, published with `showInNavigation`. */
const FAQ_TITLE = { fr: 'Questions fréquentes', en: 'FAQ', ar: 'الأسئلة الشائعة' } as const;
const CONTACT_TITLE = { fr: 'Nous contacter', en: 'Contact Us', ar: 'اتصل بنا' } as const;
const NOT_FOUND_HEADING = {
  fr: 'Page introuvable',
  en: 'Page not found',
  ar: 'الصفحة غير موجودة',
} as const;
/**
 * The title suffix every page carries. The page title renders the store name
 * resolved for the active locale (`Boutique Démo` under fr, `Demo Store`
 * under en), not the Translatable's `default` leaf, so the expectation reads
 * the same field the same way rather than pinning the `default` value and
 * failing every locale but the one that happens to equal it.
 */
function brandFor(locale: StorefrontLocale): string {
  const storeName = activeStoreConfigFixture().identity.storeName;
  return storeName[locale] ?? storeName.default;
}

test.describe('CMS pages', () => {
  let baseline: ConsoleBaseline;
  let currentPage: Page;

  test.beforeEach(({ page }) => {
    currentPage = page;
    baseline = attachConsoleBaseline(page);
  });

  test.afterEach(() => {
    // Only the browser's own log line for a document answering 404 is allowed
    // through, matched on the resource URL rather than the message text.
    baseline.assertClean({ ignore: [expectedDocumentNotFound(currentPage)] });
  });

  describeEveryLocale('published page renders', (locale) => {
    test(`/${locale}/pages/faq renders the localized CMS title and body`, async ({ page }) => {
      const response = await page.goto(`/${locale}/pages/faq`);

      expect(response?.status(), 'the generic CMS route must serve a real 200').toBe(200);
      await expect(page.locator('#cms-page-heading')).toHaveText(copyFor(FAQ_TITLE, locale));

      const body = page.locator('#cms-page-heading + .body');
      await expect(body).toHaveCount(1);
      expect((await body.innerText()).trim().length).toBeGreaterThan(0);

      expect(new URL(page.url()).pathname).toBe(`/${locale}/pages/faq`);
    });

    test(`/${locale}/pages/faq titles the tab with the brand suffix`, async ({ page }) => {
      await page.goto(`/${locale}/pages/faq`);
      const title = await page.title();
      expect(title).toContain(copyFor(FAQ_TITLE, locale));
      expect(title.endsWith(brandFor(locale)), `no brand suffix on "${title}"`).toBe(true);
    });

    test(`/${locale}/pages/faq renders its sanitized HTML as styled typography`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/pages/faq`);

      const body = page.locator('.body.rich-text-content');
      await expect(body).toHaveCount(1);

      // Tailwind preflight resets headings to inherit and strips list markers,
      // and a component-scoped rule cannot reach [innerHTML] children, so the
      // CMS body rendered h2 at body size with no bullets. Computed values are
      // the only assertion that proves the global class actually landed.
      const sizes = await body.evaluate((el) => {
        const h2 = el.querySelector('h2');
        const p = el.querySelector('p');
        const ul = el.querySelector('ul');
        return {
          h2: h2 ? parseFloat(getComputedStyle(h2).fontSize) : 0,
          p: p ? parseFloat(getComputedStyle(p).fontSize) : 0,
          marker: ul ? getComputedStyle(ul).listStyleType : 'none',
          indent: ul ? parseFloat(getComputedStyle(ul).paddingInlineStart) : 0,
        };
      });

      expect(sizes.p, 'no paragraph in the seeded FAQ body').toBeGreaterThan(0);
      expect(sizes.h2, 'h2 renders at body size').toBeGreaterThan(sizes.p);
      expect(sizes.marker).not.toBe('none');
      // Logical property, so the indent lands on the reading-start side in
      // either direction.
      expect(sizes.indent).toBeGreaterThan(0);
    });

    test(`/${locale}/about and the catalog landing stay single-branded`, async ({ request }) => {
      // The CMS pages gained the suffix; the catalog landing already carried
      // the brand in its own i18n string and must not print it twice.
      //
      // Read over raw HTTP rather than through two browser navigations. The
      // title is applied during SSR, so this is the same value a crawler and a
      // link unfurler get, and it avoids the WebKit-plus-Vite module-import
      // failure that a second in-test navigation triggers on the dev server.
      const titleOf = async (path: string): Promise<string> => {
        const res = await request.get(path);
        expect(res.status(), `${path} must render`).toBe(200);
        const match = /<title>([^<]*)<\/title>/.exec(await res.text());
        expect(match, `no <title> in the SSR HTML of ${path}`).not.toBeNull();
        return match![1].trim();
      };

      const aboutTitle = await titleOf(`/${locale}/about`);
      expect(aboutTitle.endsWith(brandFor(locale)), `no brand suffix on "${aboutTitle}"`).toBe(
        true,
      );

      const catalogTitle = await titleOf(`/${locale}/catalog`);
      expect(
        catalogTitle.split(brandFor(locale)).length - 1,
        `double-branded: "${catalogTitle}"`,
      ).toBe(1);
    });

    test(`/${locale}/pages/contact renders in the SSR HTML, before any JavaScript`, async ({
      request,
    }) => {
      const res = await request.get(`/${locale}/pages/contact`);
      const html = await res.text();

      expect(res.status()).toBe(200);
      expect(html).toContain('id="cms-page-heading"');
      expect(html).toContain(copyFor(CONTACT_TITLE, locale));
    });
  });

  describeEveryLocale('unknown and legacy slugs', (locale) => {
    test(`/${locale}/pages/<unknown> renders the not-found page under a real 404`, async ({
      page,
    }) => {
      const response = await page.goto(`/${locale}/pages/no-such-cms-page`);

      expect(response?.status(), 'a 200 here is a soft 404 on an unbounded URL space').toBe(404);
      await expect(page.locator('#not-found-heading')).toHaveText(
        copyFor(NOT_FOUND_HEADING, locale),
      );
      await expect(page.locator('#cms-page-heading')).toHaveCount(0);

      const mainChildren = await page.locator('main > *').count();
      expect(mainChildren, 'main is empty: the not-found component never mounted').toBeGreaterThan(
        0,
      );
    });

    test(`/${locale}/pages/about 404s rather than twinning the dedicated route`, async ({
      request,
    }) => {
      // `/about` keeps a dedicated route and is the canonical URL for that
      // page. Serving it here too would publish a duplicate-content twin that
      // nothing links and the sitemap does not list.
      const res = await request.get(`/${locale}/pages/about`);
      const html = await res.text();

      expect(res.status()).toBe(404);
      expect(html).toContain('id="not-found-heading"');
      expect(html).not.toContain('id="cms-page-heading"');
    });

    test(`/${locale}/about still serves the legacy page itself`, async ({ request }) => {
      // The other half of the same contract: rejecting the twin must not have
      // taken the canonical route down with it.
      const res = await request.get(`/${locale}/about`);

      expect(res.status()).toBe(200);
      expect(await res.text()).toContain('id="about-heading"');
    });
  });

  describeEveryLocale('chrome navigation', (locale) => {
    test('the footer lists the published pages that have no dedicated route', async ({ page }) => {
      await page.goto(`/${locale}/`);

      const faq = page.locator('[data-testid="footer-link-cms-faq"]');
      const contact = page.locator('[data-testid="footer-link-cms-contact"]');

      // Hydration-time, so wait rather than assert on first paint.
      await expect(faq).toHaveText(copyFor(FAQ_TITLE, locale));
      await expect(contact).toHaveText(copyFor(CONTACT_TITLE, locale));
      await expect(faq).toHaveAttribute('href', `/${locale}/pages/faq`);

      // The five built-in links are unaffected: they ship in the SSR HTML and
      // must not start depending on the fetch that adds the two above.
      await expect(page.locator('[data-testid="footer-link-about"]')).toHaveAttribute(
        'href',
        `/${locale}/about`,
      );
      await expect(page.locator('[data-testid="footer-link-terms"]')).toHaveAttribute(
        'href',
        `/${locale}/policies/terms`,
      );

      // The five slugs that own a dedicated route must not appear twice.
      await expect(page.locator('[data-testid="footer-link-cms-about"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="footer-link-cms-terms"]')).toHaveCount(0);
    });

    test('following the footer FAQ link lands on the rendered page', async ({ page }) => {
      await page.goto(`/${locale}/`);
      await page.locator('[data-testid="footer-link-cms-faq"]').click();

      await expect(page.locator('#cms-page-heading')).toHaveText(copyFor(FAQ_TITLE, locale));
      expect(new URL(page.url()).pathname).toBe(`/${locale}/pages/faq`);
    });

    test('the header Shop link lands on the catalog', async ({ page }) => {
      await page.goto(`/${locale}/`);
      // Below 768 px the drawer's "All products" link is the shop entry.
      const mobile = (page.viewportSize()?.width ?? 1440) < 768;
      if (mobile) {
        await waitForHydration(page);
        await page.locator('[data-testid="header-menu-toggle"]').click();
      }
      const shop = page.locator(
        mobile ? '[data-testid="header-menu-all"]' : '[data-testid="header-catalog-link"]',
      );
      await expect(shop).toHaveAttribute('href', `/${locale}/catalog`);

      await shop.click();
      await page.waitForURL(`**/${locale}/catalog`);
      expect(new URL(page.url()).pathname).toBe(`/${locale}/catalog`);
    });
  });
});
