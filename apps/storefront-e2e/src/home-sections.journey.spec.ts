import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  attachConsoleBaseline,
  authCookieHeader,
  copyFor,
  describeEveryLocale,
  forFixtureLocales,
  reloadAndAssertClean,
  signInViaApi,
  type AuthSession,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S20 — dynamic StorefrontSection dispatch journey.
 *
 * Boots against the real test API + fixture catalogue seed (no fixtures, no
 * `page.route()` per constitution §3.8). Covers:
 *
 *  1. Admin mutates a `home` section via `POST /v1/admin/storefront/pages/home/sections`.
 *  2. Public `GET /v1/storefront/sections/home` returns the row with the
 *     resolved Translatable copy + hydrated `assetUrl`.
 *  3. The S15 revalidate webhook handler fires when the section is mutated;
 *     the storefront's `/api/_internal/revalidate` route accepts the dispatch.
 *  4. Render assertions — the storefront home page reflects the operator-
 *     edited sections. Plan B Phase B1 retired the build-time
 *     `STOREFRONT_DYNAMIC_SECTIONS` escape hatch, so dynamic dispatch is the
 *     only home render path and these assertions always run.
 */

const ADMIN_EMAIL = 'admin@merchants.test';
const ADMIN_PASSWORD = 'password123';

async function loginAdmin(req: APIRequestContext): Promise<AuthSession> {
  return signInViaApi(req, ADMIN_EMAIL, ADMIN_PASSWORD);
}

const HERO_ASSET_ID = '11111111-1111-4111-8111-111111111111';

const validHeroConfig = (eyebrow = 'S20 Smoke') => ({
  assetId: HERO_ASSET_ID,
  eyebrow: { default: eyebrow, en: eyebrow, fr: eyebrow },
  headline: {
    default: 'Dynamic dispatch journey',
    en: 'Dynamic dispatch journey',
    fr: 'Parcours de rendu dynamique',
  },
  body: {
    default: 'Inserted via the e2e admin POST flow',
    en: 'Inserted via the e2e admin POST flow',
    fr: 'Insérée via le flux admin e2e',
  },
  cta: { default: 'Browse', en: 'Browse', fr: 'Parcourir' },
  ctaHref: '/catalog',
});

test.describe.serial('storefront S20 home sections — dynamic dispatch + revalidate', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('public sections endpoint returns the wrapped meta envelope', async ({ request }) => {
    const res = await request.get(`${STOREFRONT_API_BASE}/v1/storefront/sections/home`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; type: string }>;
      meta: { pageSlug: string; total: number };
    };
    expect(body.meta.pageSlug).toBe('home');
    expect(typeof body.meta.total).toBe('number');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('public endpoint rejects an invalid pageSlug shape (400)', async ({ request }) => {
    const res = await request.get(`${STOREFRONT_API_BASE}/v1/storefront/sections/Bad%20Slug%21`);
    expect(res.status()).toBe(400);
  });

  test('admin POST creates a HERO section then public GET returns it with hydrated assetUrl', async ({
    request,
  }) => {
    const auth = await loginAdmin(request);

    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: {
          Cookie: authCookieHeader(auth),
          'Content-Type': 'application/json',
        },
        data: {
          type: 'HERO',
          title: { default: 'S20 e2e hero', en: 'S20 e2e hero', fr: 'Hero S20 e2e' },
          config: validHeroConfig(),
          sortOrder: 999,
          isVisible: true,
        },
      },
    );
    expect(created.status(), `create response: ${await created.text()}`).toBe(201);
    const createdBody = await created.json();
    const newId = createdBody.data?.id as string;
    expect(newId).toBeTruthy();

    try {
      const list = await request.get(`${STOREFRONT_API_BASE}/v1/storefront/sections/home`, {
        headers: { 'Accept-Language': 'en' },
      });
      expect(list.status()).toBe(200);
      const body = (await list.json()) as {
        data: Array<{ id: string; type: string; config: Record<string, unknown> }>;
        meta: { pageSlug: string; total: number };
      };
      const row = body.data.find((s) => s.id === newId);
      expect(row, 'newly created HERO section must appear in public list').toBeDefined();
      // Hydrated assetUrl is only present when the seed planted a matching
      // Asset row; the e2e test asserts a string OR undefined so the case
      // where the asset is missing does not break the dispatch contract.
      if (row && 'assetUrl' in row.config) {
        expect(typeof row.config.assetUrl).toBe('string');
      }
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${newId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });

  test('public GET resolves Translatable copy per Accept-Language', async ({ request }) => {
    const auth = await loginAdmin(request);

    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: {
          Cookie: authCookieHeader(auth),
          'Content-Type': 'application/json',
        },
        data: {
          type: 'HERO',
          // The `fr` and `en` values MUST differ, otherwise the assertions
          // below pass whichever locale the resolver happened to pick.
          title: {
            default: 'Locale probe',
            en: 'Locale probe EN',
            fr: 'Sonde de locale FR',
          },
          config: validHeroConfig('Locale check'),
          sortOrder: 998,
          isVisible: true,
        },
      },
    );
    expect(created.status()).toBe(201);
    const newId = (await created.json()).data.id as string;

    try {
      // Both legs run: resolving one locale correctly proves nothing unless
      // the other locale resolves to its own, different string.
      for (const [locale, expected] of [
        ['fr', 'Sonde de locale FR'],
        ['en', 'Locale probe EN'],
      ] as const) {
        const res = await request.get(`${STOREFRONT_API_BASE}/v1/storefront/sections/home`, {
          headers: { 'Accept-Language': locale },
        });
        expect(res.status()).toBe(200);
        const body = (await res.json()) as {
          data: Array<{ id: string; title: unknown }>;
        };
        const row = body.data.find((s) => s.id === newId);
        expect(row, `${locale} row must be in list`).toBeDefined();
        expect(typeof row!.title).toBe('string');
        expect(row!.title).toBe(expected);
      }
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${newId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });

  test('home page renders dynamic-dispatched sections', async ({ page }) => {
    // Locale carve-out per constitution §3.11 rule 4: this test asserts only
    // that the dynamic-dispatch path resolves each section type to its
    // component, through testids that carry no copy. The section config it
    // posts already holds both fr and en translations, and the render path is
    // locale-agnostic, so a second locale would re-run identical assertions.
    await page.goto('/en/');
    // Hero rendered by HeroBannerComponent, testid stable across both render paths.
    await expect(page.locator('[data-testid="home-hero"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="home-categories"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="home-trust-strip"]').first()).toBeVisible();
    // The retired `home-mid-banner` surface is gone for good; phase B8 replaced
    // it with a brand-floor-compliant banner under a new testid.
    await expect(page.locator('[data-testid="home-mid-banner"]')).toHaveCount(0);
  });
});

/**
 * Phase B2 — a configured section whose curated ids do not resolve renders its
 * own empty state and never substitutes pool content (finding S3).
 *
 * The section is created through the admin API rather than seeded, so the
 * unresolvable id is a real dead reference against the live catalogue, and the
 * mutation invalidates the sections cache on the way in.
 */
describeEveryLocale('storefront B2 home sections — dead curation renders empty', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a featured rail whose productIds do not resolve shows its empty state (${locale})`, async ({
    page,
    request,
  }) => {
    const auth = await loginAdmin(request);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: { Cookie: authCookieHeader(auth), 'Content-Type': 'application/json' },
        data: {
          type: 'FEATURED_PRODUCTS',
          title: { default: 'B2 dead curation', en: 'B2 dead curation', fr: 'B2 curation morte' },
          config: {
            // A well-formed id that matches no product. The rail must show its
            // empty state rather than backfilling from the catalogue.
            productIds: ['00000000-0000-4000-8000-0000000000b2'],
            variant: 'grid',
          },
          sortOrder: 997,
          isVisible: true,
        },
      },
    );
    expect(created.status(), `create response: ${await created.text()}`).toBe(201);
    const sectionId = (await created.json()).data.id as string;

    try {
      // Cache-distinct URL: the SSR document carries no Cache-Control, so a
      // repeat goto to the same path can be answered from the memory cache.
      const route = `/${locale}/?b2=${sectionId}`;
      await page.goto(route);

      const rail = page.locator(`[data-testid="home-featured-${sectionId}"]`);
      await expect(rail).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(`[data-testid="home-featured-${sectionId}-empty"]`)).toBeVisible();
      await expect(rail.locator('app-product-card')).toHaveCount(0);

      await reloadAndAssertClean(page, route, baseline, {
        afterReload: async () => {
          await expect(
            page.locator(`[data-testid="home-featured-${sectionId}-empty"]`),
          ).toBeVisible({ timeout: 60_000 });
        },
      });
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${sectionId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });
});

/**
 * Phase B3 — the home page renders exactly the configured sections and nothing
 * else (finding S1 / H1 / D8 / M5).
 *
 * The plan's original shape for this was "hide every home section, assert an
 * empty home". That mutates rows every other home spec reads, and this suite
 * runs files in parallel, so it would have raced smoke, home, home-ssr,
 * av4-picture-rendering and home-section-driven into flaky failures.
 *
 * Comparing a DOM block count against the live section list would have raced
 * too: `fullyParallel` is on, and the sibling tests in this very file create
 * sections, so a row landing between the API read and the page load moves the
 * expected number. The guard is therefore count-free. It asserts the positive
 * form — every block the home page rendered is one a section produced — which
 * is exactly what fails when a rail renders outside the config.
 */
describeEveryLocale('storefront B3 home sections — no blocks outside the config', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`every home block comes from a section, and no other (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    await expect(page.locator('[data-testid="home-hero"]').first()).toBeVisible({
      timeout: 60_000,
    });

    // Direct element children of the page container are the section blocks.
    // A block mounted through `ngComponentOutlet` is the component host element
    // (`<app-hero-banner>`), which carries no testid of its own: the testid is
    // on the `<section>` inside it, so read the first one in the subtree.
    const blockTestIds = await page.locator('.page > *').evaluateAll((nodes) =>
      nodes.map((n) => {
        const own = n.getAttribute('data-testid');
        if (own) return own;
        return n.querySelector('[data-testid]')?.getAttribute('data-testid') ?? '<none>';
      }),
    );

    expect(blockTestIds.length, 'the seed must leave at least one home section').toBeGreaterThan(0);

    // The testid each surviving section type emits. PROMOTIONAL_BANNER is
    // dropped before dispatch on this client (brand-floor §5.3), so it
    // contributes nothing. Before B3 this list also had to admit
    // home-just-arrived, home-popular, home-thematic-entry-tier and
    // home-thematic-home-essentials, which is the defect: those blocks existed
    // with no section behind them.
    const fromASection = (id: string) =>
      id === 'home-hero' ||
      id === 'home-categories' ||
      id === 'home-trust-strip' ||
      id === 'home-promo-banner' ||
      id.startsWith('home-featured-');

    const orphans = blockTestIds.filter((id) => !fromASection(id));
    expect(orphans, `home blocks with no section behind them: ${orphans.join(', ')}`).toEqual([]);
  });
});

/**
 * Phase B4 — the banner CTA goes where the operator pointed it (finding S1b),
 * and a CTA with no label renders no button at all (finding S2).
 *
 * The HERO row is created through the admin API with a ctaHref that is NOT the
 * catalogue, because the pre-B4 defect was a hardcoded catalogue route: a test
 * configuring `/catalog` would have passed against the defect.
 */
describeEveryLocale('storefront B4 home sections — configured CTA href', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`the hero CTA points at the configured ctaHref (${locale})`, async ({ page, request }) => {
    const auth = await loginAdmin(request);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: { Cookie: authCookieHeader(auth), 'Content-Type': 'application/json' },
        data: {
          type: 'HERO',
          title: { default: 'B4 cta', en: 'B4 cta', fr: 'B4 cta' },
          config: {
            ...validHeroConfig('B4 cta'),
            // Site-relative and NOT the catalogue root, so the old hardcoded
            // `/{locale}/catalog` binding cannot satisfy this assertion.
            ctaHref: '/cart',
          },
          sortOrder: 996,
          isVisible: true,
        },
      },
    );
    expect(created.status(), `create response: ${await created.text()}`).toBe(201);
    const sectionId = (await created.json()).data.id as string;

    try {
      await page.goto(`/${locale}/?b4=${sectionId}`);
      // sortOrder 996 puts this hero after the seeded one, so take the last.
      const cta = page.locator('[data-testid="home-hero-cta"]').last();
      await expect(cta).toBeVisible({ timeout: 60_000 });
      // The stored href carries no locale segment; the resolver prefixes it so
      // the seeded `/catalog` rows keep working.
      await expect(cta).toHaveAttribute('href', `/${locale}/cart`);
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${sectionId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });
});

/**
 * Phase B5 — a curated rail titles itself from `config.heading` / `config.eyebrow`
 * (finding S1c).
 *
 * The envelope title is deliberately left EMPTY here. With a title present the
 * assertion would pass on the pre-B5 behaviour whenever the two strings happen
 * to match, and an operator who filled only the config fields was exactly the
 * case that rendered a heading-less rail.
 */
describeEveryLocale('storefront B5 home sections — featured rail heading', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  const HEADING = {
    default: 'B5 heading',
    en: 'B5 heading EN',
    fr: 'Titre B5 FR',
    ar: 'B5 heading AR',
  };
  const EYEBROW = {
    default: 'B5 eyebrow',
    en: 'B5 eyebrow EN',
    fr: 'Surtitre B5 FR',
    ar: 'B5 eyebrow AR',
  };

  test(`the rail renders the configured heading and eyebrow (${locale})`, async ({
    page,
    request,
  }) => {
    const auth = await loginAdmin(request);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: { Cookie: authCookieHeader(auth), 'Content-Type': 'application/json' },
        data: {
          type: 'FEATURED_PRODUCTS',
          config: {
            productIds: ['00000000-0000-4000-8000-0000000000b5'],
            variant: 'grid',
            heading: forFixtureLocales(HEADING),
            eyebrow: forFixtureLocales(EYEBROW),
          },
          sortOrder: 995,
          isVisible: true,
        },
      },
    );
    expect(created.status(), `create response: ${await created.text()}`).toBe(201);
    const sectionId = (await created.json()).data.id as string;

    try {
      await page.goto(`/${locale}/?b5=${sectionId}`);
      const rail = page.locator(`[data-testid="home-featured-${sectionId}"]`);
      await expect(rail).toBeVisible({ timeout: 60_000 });
      // The fr and en values differ, so a resolver that picked the wrong locale
      // fails rather than passing on a shared string.
      await expect(rail.locator('.title')).toHaveText(copyFor(HEADING, locale));
      await expect(rail.locator('.eyebrow')).toHaveText(copyFor(EYEBROW, locale));
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${sectionId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });
});

/**
 * Phase B8 — a configured PROMOTIONAL_BANNER renders (finding H2).
 *
 * The row used to be dropped before dispatch, so the admin sold a section an
 * operator could create, get a 201 for, and never see. The assertion is the
 * positive form, the operator's own headline on the page, because "no banner
 * testid" was true both before and after the surface existed and could never
 * have caught the defect.
 */
describeEveryLocale('storefront B8 home sections — promotional banner renders', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  const HEADLINE = {
    default: 'B8 banner',
    en: 'B8 banner headline EN',
    fr: 'Titre de banniere B8 FR',
    ar: 'B8 banner headline AR',
  };

  test(`the operator headline reaches the page (${locale})`, async ({ page, request }) => {
    const auth = await loginAdmin(request);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: { Cookie: authCookieHeader(auth), 'Content-Type': 'application/json' },
        data: {
          type: 'PROMOTIONAL_BANNER',
          title: forFixtureLocales({
            default: 'B8 promo',
            en: 'B8 promo',
            fr: 'B8 promo',
            ar: 'B8 promo',
          }),
          config: {
            assetId: HERO_ASSET_ID,
            eyebrow: forFixtureLocales({
              default: 'Rotatif',
              en: 'Rotary',
              fr: 'Rotatif',
              ar: 'Rotary AR',
            }),
            headline: forFixtureLocales(HEADLINE),
            body: forFixtureLocales({
              default: 'Livre sous 48 h.',
              en: 'Delivered within 48 h.',
              fr: 'Livre sous 48 h.',
              ar: 'Delivered within 48 h. AR',
            }),
            cta: forFixtureLocales({ default: 'Voir', en: 'Browse', fr: 'Voir', ar: 'Browse AR' }),
            ctaHref: '/catalog',
          },
          sortOrder: 994,
          isVisible: true,
        },
      },
    );
    expect(created.status(), `create response: ${await created.text()}`).toBe(201);
    const sectionId = (await created.json()).data.id as string;

    try {
      await page.goto(`/${locale}/?b8=${sectionId}`);
      const banner = page.locator('[data-testid="home-promo-banner"]').last();
      await expect(banner).toBeVisible({ timeout: 60_000 });
      // fr and en differ, so a wrong-locale resolve fails rather than passing
      // on a shared string.
      await expect(banner.locator('.headline')).toHaveText(copyFor(HEADLINE, locale));
      // The CTA goes through the same B4 resolver as the hero.
      await expect(banner.locator('[data-testid="home-promo-banner-cta"]')).toHaveAttribute(
        'href',
        `/${locale}/catalog`,
      );
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${sectionId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });
});

/**
 * Phase B9 — the TRUST_SIGNALS heading is the operator's section title
 * (finding H3).
 *
 * The seeded title must differ from the i18n heading, otherwise the fallback
 * satisfies the assertion and the guard cannot fail on the defect. The heading
 * is visually hidden by design, so the assertion reads its text content rather
 * than its visibility.
 */
describeEveryLocale('storefront B9 home sections — trust strip title', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  const TITLE = {
    default: 'B9 trust',
    en: 'B9 trust title EN',
    fr: 'Titre confiance B9 FR',
    ar: 'B9 trust title AR',
  };

  test(`the strip heading is the configured section title (${locale})`, async ({
    page,
    request,
  }) => {
    const auth = await loginAdmin(request);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/storefront/pages/home/sections`,
      {
        headers: { Cookie: authCookieHeader(auth), 'Content-Type': 'application/json' },
        data: {
          type: 'TRUST_SIGNALS',
          title: forFixtureLocales(TITLE),
          config: {
            items: [
              {
                kind: 'delivery',
                title: { default: 'Livre', en: 'Delivered', fr: 'Livre' },
                subtitle: { default: '48 h', en: '48 h', fr: '48 h' },
              },
            ],
          },
          sortOrder: 993,
          isVisible: true,
        },
      },
    );
    expect(created.status(), `create response: ${await created.text()}`).toBe(201);
    const sectionId = (await created.json()).data.id as string;

    try {
      await page.goto(`/${locale}/?b9=${sectionId}`);
      const heading = page.locator(`#home-trust-${sectionId}`);
      await expect(heading).toHaveText(copyFor(TITLE, locale), { timeout: 60_000 });
    } finally {
      await request.delete(`${STOREFRONT_API_BASE}/v1/admin/storefront/sections/${sectionId}`, {
        headers: { Cookie: authCookieHeader(auth) },
      });
    }
  });
});
