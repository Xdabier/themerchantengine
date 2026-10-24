import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  attachConsoleBaseline,
  authCookieHeader,
  describeEveryLocale,
  forFixtureLocales,
  reloadAndAssertClean,
  signInViaApi,
  STOREFRONT_LOCALES,
  STOREFRONT_API_BASE,
  type AuthSession,
  type ConsoleBaseline,
} from './support';

/**
 * Plan D - rich-text pipeline, storefront half.
 *
 * One field carries two content generations. Anything authored through the
 * admin WYSIWYG is sanitized HTML and must render as real elements; everything
 * seeded before that editor existed is plain text whose paragraphs are \n
 * breaks and must keep them. Rendering either one the other way is a defect
 * customers see, so both branches are pinned here against the real API.
 *
 * Serial, because every scenario mutates a shared seed row. Every mutation
 * restores the original value in `finally`.
 */

const ADMIN_EMAIL = 'admin@merchants.test';
const ADMIN_PASSWORD = 'password123';

const RICH_MARKER = 'BOLD-QA';
const RICH_HTML =
  `<p>Description enrichie avec <strong>${RICH_MARKER}</strong> et <em>italique</em>.</p>` +
  '<p>Second paragraphe.</p>' +
  '<ul><li>Premier point</li><li>Second point</li></ul>';
const PLAIN_TEXT = 'Ligne une.\n\nLigne deux.';

interface ProductRef {
  id: string;
  slug: string;
  description: unknown;
  shortDescription: unknown;
}

/**
 * Slug discovery through the products sitemap, the same seed-agnostic pattern
 * `product-detail-ssr.journey.spec.ts` uses. The FIRST entry is claimed by that
 * spec, so this one starts at the second and the two never fight over the same
 * row.
 *
 * `offset` gives each locale branch a row of its own. The suite is
 * fullyParallel, and `describe.serial` only orders the tests INSIDE one
 * describe, so the fr and en branches run at the same time on two workers: on
 * a shared row one branch's restore lands while the other is still asserting.
 */
async function pickProduct(
  request: APIRequestContext,
  session: AuthSession,
  offset: number,
): Promise<ProductRef> {
  const sitemap = await request.get('/sitemap-products.xml');
  expect(sitemap.status()).toBe(200);
  const slugs = [
    ...new Set(
      [...(await sitemap.text()).matchAll(/\/catalog\/product\/([^<]+)<\/loc>/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  expect(slugs.length, 'the products sitemap must carry a row per locale branch').toBeGreaterThan(
    offset,
  );
  const slug = slugs[offset];

  const publicRes = await request.get(`${STOREFRONT_API_BASE}/v1/products/${slug}`);
  expect(publicRes.status()).toBe(200);
  const { data } = (await publicRes.json()) as { data: { id: string } };

  // `X-Resolve-Locale: false` like every admin read, or the interceptor hands
  // back the resolved string and the restore in `finally` 400s on a shape the
  // DTO will not take.
  const adminRes = await request.get(`${STOREFRONT_API_BASE}/v1/admin/products/${data.id}`, {
    headers: { Cookie: authCookieHeader(session), 'X-Resolve-Locale': 'false' },
  });
  expect(adminRes.status()).toBe(200);
  const admin = (await adminRes.json()) as {
    data: { description: unknown; shortDescription: unknown };
  };

  return {
    id: data.id,
    slug,
    description: restorable(admin.data.description),
    shortDescription: restorable(admin.data.shortDescription),
  };
}

// The seed writes every locale it knows, so a stored row can carry a locale
// this fixture disables, and echoing it back 400s on the locale validator.
function restorable(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return forFixtureLocales(value as Record<string, unknown>);
}

/** The same text under `default` and every fixture locale. */
function inEveryLocale(text: string): Record<string, string> {
  return {
    default: text,
    ...Object.fromEntries(STOREFRONT_LOCALES.map((key) => [key, text])),
  };
}

async function patchDescription(
  request: APIRequestContext,
  session: AuthSession,
  id: string,
  description: unknown,
): Promise<void> {
  const res = await request.patch(`${STOREFRONT_API_BASE}/v1/admin/products/${id}`, {
    headers: { Cookie: authCookieHeader(session) },
    data: { description },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function patchShortDescription(
  request: APIRequestContext,
  session: AuthSession,
  id: string,
  shortDescription: unknown,
): Promise<void> {
  const res = await request.patch(`${STOREFRONT_API_BASE}/v1/admin/products/${id}`, {
    headers: { Cookie: authCookieHeader(session) },
    data: { shortDescription },
  });
  expect(res.status(), await res.text()).toBe(200);
}

interface CategoryRef {
  id: string;
  slug: string;
  description: unknown;
}

const CATEGORY_INTRO =
  '<p>Intro <strong>enrichie</strong> de rayon.</p><img src=x onerror="window.__pwn = 1">';

/**
 * Categories are read through the public tree, which is the only surface that
 * carries the slug a customer route uses. `offset` gives each locale branch its
 * own row for the same reason the product picker does.
 */
async function pickCategory(
  request: APIRequestContext,
  session: AuthSession,
  offset: number,
): Promise<CategoryRef> {
  const res = await request.get(`${STOREFRONT_API_BASE}/v1/categories`);
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: { id: string; slug: string }[] };
  expect(data.length, 'the seed must carry a category per locale branch').toBeGreaterThan(offset);
  const picked = data[offset];

  const adminRes = await request.get(`${STOREFRONT_API_BASE}/v1/admin/categories`, {
    headers: { Cookie: authCookieHeader(session), 'X-Resolve-Locale': 'false' },
  });
  expect(adminRes.status()).toBe(200);
  const admin = (await adminRes.json()) as {
    data: { id: string; description: unknown; children?: unknown[] }[];
  };
  const flat: { id: string; description: unknown }[] = [];
  const walk = (nodes: { id: string; description: unknown; children?: unknown[] }[]): void => {
    for (const node of nodes) {
      flat.push(node);
      if (node.children) walk(node.children as typeof nodes);
    }
  };
  walk(admin.data);
  const row = flat.find((entry) => entry.id === picked.id);
  expect(row, 'the picked category must exist in the admin tree').toBeTruthy();

  return { id: picked.id, slug: picked.slug, description: restorable(row!.description) };
}

async function patchCategoryDescription(
  request: APIRequestContext,
  session: AuthSession,
  id: string,
  description: unknown,
): Promise<void> {
  const res = await request.patch(`${STOREFRONT_API_BASE}/v1/admin/categories/${id}`, {
    headers: { Cookie: authCookieHeader(session) },
    data: { description },
  });
  expect(res.status(), await res.text()).toBe(200);
}

describeEveryLocale('rich text on the category page', (locale) => {
  const categoryOffset = STOREFRONT_LOCALES.indexOf(locale);

  test.describe.serial(`category intro rendering @${locale}`, () => {
    let baseline: ConsoleBaseline;

    test.beforeEach(({ page }) => {
      baseline = attachConsoleBaseline(page);
    });
    test.afterEach(() => {
      baseline.assertClean();
    });

    test('the authored intro renders, scrubbed of its script vector', async ({ page, request }) => {
      const session = await signInViaApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const category = await pickCategory(request, session, categoryOffset);
      const route = `/${locale}/catalog/${category.slug}`;
      try {
        await patchCategoryDescription(
          request,
          session,
          category.id,
          inEveryLocale(CATEGORY_INTRO),
        );

        // The write-side scrub is the one that matters: a direct API call
        // bypasses the admin's client-side sanitize entirely.
        const publicRes = await request.get(
          `${STOREFRONT_API_BASE}/v1/categories/${category.slug}`,
        );
        expect(publicRes.status()).toBe(200);
        const payload = await publicRes.text();
        expect(payload, 'the stored value must carry no event handler').not.toContain('onerror');

        await page.goto(route);
        const intro = page.locator('[data-testid="category-intro"]');
        await expect(intro).toBeVisible();
        await expect(intro.locator('strong')).toHaveText('enrichie');
        expect((await intro.innerText()).trim()).not.toContain('<p');
        expect(
          await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pwn']),
        ).toBeUndefined();

        // A cache-distinct return URL. The storefront document carries no
        // Cache-Control, so a second goto of the SAME url can be served from
        // Chromium's memory cache, which showed the pre-PATCH description and
        // made this assertion flake. The query param is ignored by the page.
        await reloadAndAssertClean(page, `${route}?qa=${Date.now()}`, baseline, {
          afterReload: async () => {
            await expect(page.locator('[data-testid="category-intro"] strong')).toHaveText(
              'enrichie',
            );
          },
        });
      } finally {
        // An empty default when the row had none. A null PATCH is skipped by
        // @IsOptional (the test value would survive) and a bare `{}` fails the
        // TranslatableDto shape, so neither restores the row.
        await patchCategoryDescription(
          request,
          session,
          category.id,
          category.description ?? { default: '' },
        );
      }
    });
  });
});

describeEveryLocale('rich text on the product page', (locale) => {
  // Index 0 belongs to product-detail-ssr.journey.spec.ts.
  const productOffset = STOREFRONT_LOCALES.indexOf(locale) + 1;

  test.describe.serial(`product description rendering @${locale}`, () => {
    let baseline: ConsoleBaseline;

    test.beforeEach(({ page }) => {
      baseline = attachConsoleBaseline(page);
    });
    test.afterEach(() => {
      baseline.assertClean();
    });

    test('an authored HTML description renders as real elements', async ({ page, request }) => {
      const session = await signInViaApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const product = await pickProduct(request, session, productOffset);
      const route = `/${locale}/catalog/product/${product.slug}`;
      try {
        await patchDescription(request, session, product.id, inEveryLocale(RICH_HTML));

        await page.goto(route);
        const description = page.locator('[data-testid="product-description"]');
        await expect(description).toBeVisible();
        await expect(description.locator('strong')).toHaveText(RICH_MARKER);
        await expect(description.locator('li')).toHaveCount(2);

        // The defect this replaces showed the customer the tag text itself.
        const text = (await description.innerText()).trim();
        expect(text, 'the customer must never read the markup').not.toContain('<p');
        expect(text).not.toContain('<strong');

        await reloadAndAssertClean(page, route, baseline, {
          afterReload: async () => {
            await expect(page.locator('[data-testid="product-description"] strong')).toHaveText(
              RICH_MARKER,
            );
          },
        });
      } finally {
        await patchDescription(request, session, product.id, product.description);
      }
    });

    test('the SSR meta description and JSON-LD carry no markup', async ({ request }) => {
      // Raw SSR bytes, no browser engine: the same engine-agnostic read
      // product-detail-ssr.journey.spec.ts uses. Both spellings are asserted
      // because an attribute-escaped leak reads as `&lt;p` rather than `<p`.
      const session = await signInViaApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const product = await pickProduct(request, session, productOffset);
      const route = `/${locale}/catalog/product/${product.slug}`;
      try {
        await patchDescription(request, session, product.id, inEveryLocale(RICH_HTML));

        const res = await request.get(route);
        expect(res.status()).toBe(200);
        const html = await res.text();

        const metaDescription = html.match(
          /<meta[^>]+name="description"[^>]+content="([^"]*)"/i,
        )?.[1];
        expect(metaDescription, 'the SSR HTML must carry a meta description').toBeTruthy();
        for (const spelling of ['<p', '&lt;p', '<strong', '&lt;strong']) {
          expect(metaDescription!, `meta description leaked ${spelling}`).not.toContain(spelling);
        }

        const jsonLd = [
          ...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
        ]
          .map((match) => match[1])
          .find(
            (body) => body.includes('"@type":"Product"') || body.includes('"@type": "Product"'),
          );
        expect(jsonLd, 'the product page must emit Product JSON-LD').toBeTruthy();
        const productLd = JSON.parse(jsonLd!) as { description?: string };
        expect(productLd.description, 'JSON-LD description must be plain prose').not.toContain('<');
        expect(productLd.description).toContain(RICH_MARKER);
      } finally {
        await patchDescription(request, session, product.id, product.description);
      }
    });

    test('the short description shows as the product subtitle', async ({ page, request }) => {
      const session = await signInViaApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const product = await pickProduct(request, session, productOffset);
      const route = `/${locale}/catalog/product/${product.slug}`;
      const pitch = 'Accroche courte QA.';
      try {
        await patchShortDescription(request, session, product.id, inEveryLocale(pitch));

        await page.goto(route);
        const subtitle = page.locator('[data-testid="product-short-description"]');
        await expect(subtitle).toBeVisible();
        await expect(subtitle).toHaveText(pitch);

        await reloadAndAssertClean(page, route, baseline, {
          afterReload: async () => {
            await expect(page.locator('[data-testid="product-short-description"]')).toHaveText(
              pitch,
            );
          },
        });
      } finally {
        // An empty default when the row had none: a null PATCH is skipped by
        // @IsOptional and a bare `{}` fails the TranslatableDto shape.
        await patchShortDescription(
          request,
          session,
          product.id,
          product.shortDescription ?? { default: '' },
        );
      }
    });

    test('a legacy plain-text description keeps its paragraph breaks', async ({
      page,
      request,
    }) => {
      const session = await signInViaApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const product = await pickProduct(request, session, productOffset);
      const route = `/${locale}/catalog/product/${product.slug}`;
      try {
        await patchDescription(request, session, product.id, inEveryLocale(PLAIN_TEXT));

        await page.goto(route);
        const description = page.locator('[data-testid="product-description"]');
        await expect(description).toBeVisible();

        // Computed style, not a class name: the class could be present while
        // the rule was dropped, and the customer would still see one blob.
        const whiteSpace = await description.evaluate((el) => getComputedStyle(el).whiteSpace);
        expect(whiteSpace, 'plain-text breaks must survive as rendered space').toBe('pre-wrap');
        await expect(description).toContainText('Ligne une.');
        await expect(description).toContainText('Ligne deux.');

        await reloadAndAssertClean(page, route, baseline, {
          afterReload: async () => {
            await expect(page.locator('[data-testid="product-description"]')).toContainText(
              'Ligne deux.',
            );
          },
        });
      } finally {
        await patchDescription(request, session, product.id, product.description);
      }
    });
  });
});
