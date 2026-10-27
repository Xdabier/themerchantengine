import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  apiHeaders,
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  signInAsAdmin,
  STOREFRONT_API_BASE,
  STOREFRONT_LOCALES,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Plan I phase I2. The storefront renders what the admin configured.
 *
 * Five admin screens used to round-trip their values into a void: nothing on
 * the storefront read the store identity, the currency, the locales, the
 * low-stock threshold or the pixel ids (findings D2, D4, D5, D6, D7). This
 * journey drives the real admin settings API, reloads the storefront and
 * asserts the change reached the page.
 *
 * No `page.route()` anywhere (§3.8). The one thing to know about timing: the
 * public config is cached for 60 s server-side, so an assertion made straight
 * after a PATCH would read the pre-mutation payload. Every read here polls
 * within a bounded window rather than sleeping a fixed minute.
 *
 * Every test restores the settings it touched in `finally`. These are global
 * rows: a leftover value changes what every other spec in the suite renders,
 * which is also why the whole file runs serially. `describeEveryLocale` fans
 * its two branches across workers by default, and the first branch to finish
 * was restoring the settings while the second was still asserting on them.
 */

test.describe.configure({ mode: 'serial' });

const GENERAL_SETTINGS_URL = `${STOREFRONT_API_BASE}/v1/admin/settings`;
const CURRENCIES_URL = `${STOREFRONT_API_BASE}/v1/admin/currencies`;

/** Same gate `auth.journey.spec.ts` uses: flows that need real hydration only
 * run against the built storefront, never the Vite dev server. */
const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

/** The server-side config TTL, plus room for the SSR render that follows. */
const CONFIG_TTL_MS = 75_000;
const POLL_INTERVAL_MS = 3_000;

async function readSettings(
  request: APIRequestContext,
  locale: StorefrontLocale,
): Promise<Record<string, Record<string, unknown>>> {
  const auth = await signInAsAdmin(request);
  const res = await request.get(GENERAL_SETTINGS_URL, {
    headers: { ...apiHeaders(auth, locale), 'X-Resolve-Locale': 'false' },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as Record<string, Record<string, unknown>>;
}

async function patchSettings(
  request: APIRequestContext,
  locale: StorefrontLocale,
  body: Record<string, unknown>,
): Promise<void> {
  const auth = await signInAsAdmin(request);
  const res = await request.patch(GENERAL_SETTINGS_URL, {
    headers: apiHeaders(auth, locale),
    data: body,
  });
  expect(res.ok(), `PATCH /v1/admin/settings failed: ${res.status()}`).toBeTruthy();
}

/**
 * Reload until the assertion holds or the config TTL expires.
 *
 * A fixed wait would have to be the full TTL on every test. Polling makes the
 * common case fast and still fails honestly when the value never arrives.
 */
async function reloadUntil(
  page: import('@playwright/test').Page,
  route: string,
  assertion: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + CONFIG_TTL_MS;
  let lastError: unknown;
  for (;;) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    try {
      await assertion();
      return;
    } catch (err) {
      lastError = err;
      if (Date.now() >= deadline) throw lastError;
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  }
}

describeEveryLocale('store config: operator identity reaches the storefront', (locale) => {
  let baseline: ConsoleBaseline;

  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });

  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`the footer contact block is absent until an operator configures one (${locale})`, async ({
    page,
    request,
  }) => {
    const before = await readSettings(request, locale);
    const original = {
      contactEmail: before['general']?.['contactEmail'] ?? '',
      phone: before['general']?.['phone'] ?? '',
      socialLinks: before['general']?.['socialLinks'] ?? {},
    };

    try {
      await patchSettings(request, locale, { contactEmail: '', phone: '', socialLinks: {} });

      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.getByTestId('footer-contact')).toHaveCount(0);
      });
    } finally {
      await patchSettings(request, locale, original);
    }
  });

  test(`a configured email, phone and social profile all render in the footer (${locale})`, async ({
    page,
    request,
  }) => {
    const before = await readSettings(request, locale);
    const original = {
      contactEmail: before['general']?.['contactEmail'] ?? '',
      phone: before['general']?.['phone'] ?? '',
      socialLinks: before['general']?.['socialLinks'] ?? {},
    };
    const email = `e2e-i2-${locale}@example.test`;
    // E.164 without separators: the settings PATCH is as strict as the wire contract.
    const phone = '+21671000000';
    const facebook = `https://facebook.com/e2e-i2-${locale}`;

    try {
      await patchSettings(request, locale, {
        contactEmail: email,
        phone,
        socialLinks: { facebook, instagram: '' },
      });

      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.getByTestId('footer-contact-email')).toHaveAttribute(
          'href',
          `mailto:${email}`,
        );
      });

      await expect(page.getByTestId('footer-contact-email')).toHaveText(email);
      await expect(page.getByTestId('footer-contact-phone')).toHaveAttribute(
        'href',
        'tel:+21671000000',
      );
      // The blank instagram value is dropped server-side, so exactly one link
      // renders rather than an empty anchor beside the real one.
      await expect(page.locator('[data-testid^="footer-social-"]')).toHaveCount(1);
      await expect(page.getByTestId('footer-social-facebook')).toHaveAttribute('href', facebook);

      // The Organization JSON-LD carries the same two facts, so a crawler and
      // a reader cannot disagree about how to reach this store.
      const jsonLd = await page
        .locator('script[type="application/ld+json"][data-home-jsonld]')
        .allTextContents();
      const organization = jsonLd
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .find((payload) => payload['@type'] === 'Organization');
      expect(organization).toBeDefined();
      expect(organization?.['sameAs']).toEqual([facebook]);
      expect(organization?.['contactPoint']).toMatchObject({ email });

      await reloadAndAssertClean(page, `/${locale}/`, baseline, {
        afterReload: async () => {
          await expect(page.getByTestId('footer-contact-email')).toHaveText(email);
        },
      });
    } finally {
      await patchSettings(request, locale, original);
    }
  });

  test(`the store currency relabels every price (${locale})`, async ({ page, request }) => {
    // Finding D5: every money surface was labelled from a baked constant, so
    // the admin currency editor changed nothing a customer could see.
    //
    // This relabels, it does not convert. Prices are stored as bare decimals
    // with no currency of their own, which is exactly why the restore below is
    // in a `finally` and not at the end of the happy path.
    const auth = await signInAsAdmin(request);
    const headers = apiHeaders(auth, locale);
    const before = await request.get(`${CURRENCIES_URL}/store`, { headers });
    expect(before.ok()).toBeTruthy();
    const original = (await before.json()).data as { code: string; enabled: string[] };

    try {
      const patched = await request.patch(CURRENCIES_URL, {
        headers,
        data: { enabled: [...new Set([...original.enabled, 'EUR'])], defaultCode: 'EUR' },
      });
      expect(patched.ok(), `currency PATCH failed: ${patched.status()}`).toBeTruthy();

      // The rendered unit is the store's configured symbol, not the ISO code.
      // Since plan E2.4 a price for the store currency renders `money.symbol`,
      // so asserting the literal `EUR` asserted the shape the storefront had
      // before the money format became config-driven. Read the symbol the API
      // now reports for the new currency rather than assuming either form.
      const after = await request.get(`${CURRENCIES_URL}/store`, { headers });
      const relabelled = (await after.json()).data as { code: string; symbol: string };
      expect(relabelled.code).toBe('EUR');
      const unit = relabelled.symbol;

      await reloadUntil(page, `/${locale}/catalog`, async () => {
        await expect(
          page.locator('[data-testid="catalog-grid"] app-product-card .amount').first(),
        ).toContainText(unit);
      });

      await reloadAndAssertClean(page, `/${locale}/catalog`, baseline, {
        afterReload: async () => {
          await expect(
            page.locator('[data-testid="catalog-grid"] app-product-card .amount').first(),
          ).toContainText(unit);
        },
      });
    } finally {
      await request.patch(CURRENCIES_URL, {
        headers,
        data: { enabled: original.enabled, defaultCode: original.code },
      });
    }
  });

  // The forgot-password SUBMIT is dev-tier-hostile for the same reason every
  // other authenticated flow in `auth.journey.spec.ts` is: the success panel
  // only paints after hydration, which the Vite dev server does not reliably
  // complete. The support line itself is pinned by
  // `forgot-password.page.spec.ts`, which asserts both the configured address
  // and the hidden-when-unconfigured branch.
  if (STOREFRONT_E2E_BUILT) {
    test(`the forgot-password support line follows the configured address (${locale})`, async ({
      page,
      request,
    }) => {
      const before = await readSettings(request, locale);
      const original = { contactEmail: before['general']?.['contactEmail'] ?? '' };
      const email = `e2e-i2-support-${locale}@example.test`;

      try {
        await patchSettings(request, locale, { contactEmail: email });

        // Wait out the config TTL on a page that costs nothing to reload, so
        // the single forgot-password submit below is not repeated into the
        // endpoint's rate limit.
        await reloadUntil(page, `/${locale}/`, async () => {
          await expect(page.getByTestId('footer-contact-email')).toHaveAttribute(
            'href',
            `mailto:${email}`,
          );
        });

        await page.goto(`/${locale}/auth/forgot-password`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('auth-forgot-email').fill(`e2e-i2-${Date.now()}@example.test`);
        // The testid sits on the `app-button` host; the control is inside it.
        await page.locator('button[data-testid="auth-forgot-submit"]').click();
        await expect(page.getByTestId('auth-forgot-success')).toBeVisible();
        await expect(page.getByTestId('auth-forgot-support-mailto')).toHaveAttribute(
          'href',
          `mailto:${email}`,
        );
      } finally {
        await patchSettings(request, locale, original);
      }
    });
  }
});

/**
 * Plan I phase I5, finding D6.
 *
 * The finding was that the storefront hardcoded its locale pair while the
 * API's own default disagreed and nothing read the admin knob. On this branch
 * the two already agree, so this is the cross-stack guard rather than a fix:
 * it reads the real config endpoint and the real root redirect, and goes red
 * the moment either side moves without the other.
 */
test.describe('store config - locale agreement', () => {
  let baseline: ConsoleBaseline;

  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });

  test.afterEach(() => {
    baseline.assertClean();
  });

  test('the API serves exactly the locale set this storefront was built with', async ({
    request,
  }) => {
    const res = await request.get(`${STOREFRONT_API_BASE}/v1/storefront/config`);
    expect(res.ok()).toBeTruthy();
    const { supportedLocales, defaultLocale } = (await res.json()).data.locales as {
      supportedLocales: string[];
      defaultLocale: string;
    };

    expect(supportedLocales).toEqual([...STOREFRONT_LOCALES]);
    // A configured default outside the baked set could never render: the
    // string catalogues and the `Locale` union are compile-time.
    expect(STOREFRONT_LOCALES).toContain(defaultLocale as StorefrontLocale);
  });

  test('the root redirect lands on the locale the API calls default', async ({ page, request }) => {
    const res = await request.get(`${STOREFRONT_API_BASE}/v1/storefront/config`);
    const { defaultLocale } = (await res.json()).data.locales as { defaultLocale: string };

    // A fresh context, so no storefront_locale cookie from an earlier test can
    // steer this: the cookie deliberately wins over everything else.
    const context = await page.context().browser()!.newContext({ locale: 'de-DE' });
    try {
      const fresh = await context.newPage();
      const response = await fresh.goto('/', { waitUntil: 'domcontentloaded' });
      expect(response?.ok()).toBeTruthy();
      expect(new URL(fresh.url()).pathname).toBe(`/${defaultLocale}/`);
    } finally {
      await context.close();
    }
  });
});
