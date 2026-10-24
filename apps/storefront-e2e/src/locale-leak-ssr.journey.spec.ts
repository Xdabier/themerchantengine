import { expect, test } from '@playwright/test';

import {
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  otherLocales,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * SSR locale split-brain regression: `/fr/` must render FRENCH API-driven copy
 * and `/en/` must render ENGLISH.
 *
 * Before the fix, every `[locale]/**` page-server companion derived the SSR
 * data-fetch locale from `req.url`, which at the Nitro page-endpoint layer is
 * the internal `/api/_analog/pages/<locale>/...` path, unreadable by the
 * start-anchored `localeFromPathname`. The factory fell back to
 * `DEFAULT_LOCALE`, so on `/en/...` the page chrome was English while every
 * API-resolved string (CMS titles, product names) came back in the default
 * locale. It shipped to production.
 *
 * Two of the locales are Latin-script, so "which script is this" cannot tell
 * them apart and a script-class probe would pass while asserting nothing.
 * Every check here is therefore an exact equality against a seeded string, plus
 * the negative: every other locale's string must appear NOWHERE in the SSR
 * HTML. The negative runs under EVERY locale, because a leak in any
 * direction is the same defect.
 *
 * Assertions run against the RAW SSR HTML (`request.get`, no browser), the true
 * leak surface. A `page.goto` would hydrate and let the browser client
 * re-resolve locale from `<html lang>`, masking an SSR-only regression. The
 * `*-ssr.journey.spec.ts` suite asserts only structural facts (ids, og:locale,
 * hreflang, JSON-LD @type) and never a concrete API-driven string; this spec
 * closes that gap (plan §3.4, §7.3).
 *
 * Seed authority: `prisma/seed.ts` cmsPages carries distinct `fr`, `en` and `ar`
 * titles for `/privacy-policy` and `/return-policy`, and the fixture catalogue product
 * seed carries distinct names per locale, so the split is reproducible.
 */

type PolicySlug = 'privacy' | 'returns';

/** `prisma/seed.ts` cmsPages titles, keyed by the `policies/<slug>` route. */
const POLICY_TITLES: Record<PolicySlug, Partial<Record<StorefrontLocale, string>>> = {
  privacy: { fr: 'Politique de confidentialité', en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
  returns: { fr: 'Politique de retour', en: 'Return Policy', ar: 'سياسة الإرجاع' },
};

/** Seeded fixture catalogue product whose `fr` and `en` names share no word order. */
const PRODUCT_SLUG = 'fx-laptop-pro-14-plus';
const PRODUCT_NAMES: Partial<Record<StorefrontLocale, string>> = {
  fr: 'Ordinateur portable Northwind Pro 14 Plus',
  en: 'Northwind Pro 14 Plus Laptop',
  ar: 'حاسوب Northwind Pro 14 Plus المحمول',
};

function stripMarkup(fragment: string): string {
  return fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inner text of `<… id="policy-heading">`. The policy `<h1>` renders the
 * API-resolved CMS title. */
function extractPolicyHeading(html: string): string | null {
  const match = html.match(/id="policy-heading"[^>]*>([\s\S]*?)<\//i);
  if (!match) return null;
  const text = stripMarkup(match[1]);
  return text.length > 0 ? text : null;
}

/** Inner text of the product-summary `<h1 class="title">`. Renders the
 * API-resolved product name. */
function extractProductHeading(html: string): string | null {
  const match = html.match(/<h1[^>]*class="title"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const text = stripMarkup(match[1]);
  return text.length > 0 ? text : null;
}

describeEveryLocale('SSR renders locale-correct API-driven copy', (locale) => {
  const wrongLocales = otherLocales(locale);

  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  for (const slug of ['privacy', 'returns'] as const) {
    test(`/${locale}/policies/${slug} <h1> is exactly the ${locale} CMS title in SSR HTML`, async ({
      request,
    }) => {
      const res = await request.get(`/${locale}/policies/${slug}`);
      expect(res.status()).toBe(200);
      const html = await res.text();

      const heading = extractPolicyHeading(html);
      expect(
        heading,
        `policy-heading text missing from /${locale}/policies/${slug} SSR HTML`,
      ).toBeTruthy();

      expect(heading, `/${locale}/policies/${slug} rendered the wrong-locale CMS title`).toBe(
        copyFor(POLICY_TITLES[slug], locale),
      );
      // The leak fingerprint: any other locale's title reaching the page at all.
      // It can only get there through the SSR data-fetch locale, so its
      // absence is the assertion that actually catches the defect.
      for (const wrongLocale of wrongLocales) {
        const wrong = POLICY_TITLES[slug][wrongLocale];
        if (wrong === undefined) continue;
        expect(
          html,
          `the ${wrongLocale} title leaked into /${locale}/policies/${slug} SSR HTML`,
        ).not.toContain(wrong);
      }
    });
  }

  test(`/${locale}/catalog/product/${PRODUCT_SLUG} <h1> is exactly the ${locale} product name`, async ({
    request,
  }) => {
    const res = await request.get(`/${locale}/catalog/product/${PRODUCT_SLUG}`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    const heading = extractProductHeading(html);
    expect(
      heading,
      `product title heading missing from /${locale}/catalog/product/${PRODUCT_SLUG} SSR HTML`,
    ).toBeTruthy();

    expect(heading, `/${locale} rendered the wrong-locale product name`).toBe(
      copyFor(PRODUCT_NAMES, locale),
    );
    for (const wrongLocale of wrongLocales) {
      const wrongName = PRODUCT_NAMES[wrongLocale];
      if (wrongName === undefined) continue;
      expect(
        html,
        `the ${wrongLocale} product name leaked into the /${locale} product SSR HTML`,
      ).not.toContain(wrongName);
    }
  });

  test(`/${locale}/catalog product-card names never carry another locale's copy`, async ({
    request,
  }) => {
    const res = await request.get(`/${locale}/catalog`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // `<h3 class="title">` is unique to `<app-product-card>`; the card renders
    // the API-resolved name, so an empty list means the grid never SSR'd and
    // the leak check below would be vacuous.
    const cardTitleRe = /<h3[^>]*class="title"[^>]*>([\s\S]*?)<\/h3>/gi;
    const titles: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = cardTitleRe.exec(html)) !== null) {
      const text = stripMarkup(match[1]);
      if (text) titles.push(text);
    }
    expect(
      titles.length,
      `no product-card titles found in /${locale}/catalog SSR HTML`,
    ).toBeGreaterThan(0);

    // The catalog grid is paginated, so which products land on page 1 is
    // seed-order dependent. The contract that does not move: whichever names
    // render, none of them may be the counterpart locale's spelling.
    const wrongNames = wrongLocales.flatMap((wrongLocale) => PRODUCT_NAMES[wrongLocale] ?? []);
    expect(
      titles.filter((title) => wrongNames.includes(title)),
      `other-locale product names leaked into /${locale}/catalog SSR HTML`,
    ).toEqual([]);
  });
});

/**
 * The client half of the same split-brain.
 *
 * The browser `ApiClient` resolves its locale ONCE at construction time, from
 * the `<html lang>` attribute (`browser-api-client.ts` `resolveBrowserLocale`),
 * and falls back to `DEFAULT_STOREFRONT_LOCALE` when that attribute does not
 * match a supported locale. If the resolver's locale list and the app's ever
 * disagree, SSR paints one language and every post-hydration fetch asks the API
 * for another, under a perfectly valid 200. That is the highest-severity defect
 * in the locale spine, and only a real browser request proves it is closed, so
 * this asserts on a live `/v1/*` call with no `page.route()` and no mock.
 */
describeEveryLocale('post-hydration API calls carry the SSR-rendered locale', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`every browser API call after an SSR /${locale}/ render sends Accept-Language: ${locale}`, async ({
    page,
  }) => {
    // The subject is `X-Locale`, not `Accept-Language`, and that is the whole
    // point of the header existing. A page cannot set `Accept-Language`: it is
    // a forbidden header name in the Fetch standard, Chromium relaxed that and
    // WebKit did not, so asserting on it here measured the browser's own
    // preference rather than anything the storefront decided. Proved by a
    // captured request where the app's `x-request-id` arrived intact and its
    // `accept-language` did not.
    //
    // Every call, not "the first one". This used to race two transports: the
    // shell's `getSession()` goes through the Better Auth client, the cart's
    // fetch goes through the browser API client, and they set the header by
    // different mechanisms. Whichever landed first decided what the test
    // measured, so a leak in the other one was invisible, and a WebKit-only
    // ordering difference read as a locale bug that could not be reproduced.
    const pending: Promise<{ url: string; locale: string | undefined }>[] = [];
    page.on('request', (req) => {
      if (!new URL(req.url()).pathname.startsWith('/v1/')) return;
      // `allHeaders()` rather than the synchronous `headers()`: the sync form
      // reports the headers Playwright saw at request creation, which on some
      // engines is the context default rather than what the app set on the
      // fetch. The async form reports what actually went on the wire, which is
      // the only thing this test is about.
      pending.push(req.allHeaders().then((h) => ({ url: req.url(), locale: h['x-locale'] })));
    });

    // The cart page SSRs its shell and hydrates the cart over the wire
    // (`cart/index.page.ts` ngOnInit), so an anonymous visit always issues at
    // least one browser-side `GET /v1/cart`.
    await page.goto(`/${locale}/cart`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    // Wait for the cart fetch to have resolved one way or the other, so the
    // collector above has seen every call this page makes.
    await expect(
      page.locator(
        '[data-testid="cart-empty"], [data-testid="cart-items"], [data-testid="cart-error"]',
      ),
    ).toBeVisible({ timeout: 60_000 });

    const seen = await Promise.all(pending);
    expect(seen.length, 'no browser-side /v1 call was made at all').toBeGreaterThan(0);
    const wrong = seen.filter((r) => r.locale !== locale);
    expect(
      wrong.map((r) => `${r.url} -> ${r.locale ?? '(none)'}`),
      `asked the API for the wrong locale after an SSR /${locale}/ render`,
    ).toEqual([]);
  });
});
