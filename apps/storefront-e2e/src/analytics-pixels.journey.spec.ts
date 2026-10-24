import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  apiHeaders,
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  signInAsAdmin,
  STOREFRONT_API_BASE,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Plan I phase I8. A pixel configured in the admin loads its tag (finding D2).
 *
 * The admin has had a pixel editor since the analytics module shipped and the
 * storefront injected nothing anywhere, so an operator could configure GA4,
 * Meta, TikTok and Snap and change nothing a browser would ever do.
 *
 * The pixel ids are seeded through `PATCH /v1/admin/analytics/pixels`, which is
 * the real editor. NOT through `/settings/integrations`: that screen's
 * "Analytics key" field was never stored anywhere, which is what phase I9
 * removes.
 *
 * Serial, and every id restored in `finally`: the pixel config is one global
 * StoreSetting row, so a leftover value would inject a tag into every other
 * spec in the suite.
 */

test.describe.configure({ mode: 'serial' });

const PIXELS_URL = `${STOREFRONT_API_BASE}/v1/admin/analytics/pixels`;

/** The server caches the public config for 60 s. */
const CONFIG_TTL_MS = 75_000;
const POLL_INTERVAL_MS = 3_000;

const SENTINEL_GA4 = 'G-E2EI8TEST';
const SENTINEL_META = '1234567890123';

/**
 * Two unwraps, not one. The pixels handler wraps its own result in `{ data }`
 * and the global response interceptor wraps that again, so the payload arrives
 * as `{ data: { data: {...} } }`. `AnalyticsService` in `libs/admin-services`
 * compensates the same way and calls it out in a comment; reading one level
 * here would hand the restore step a body with a rogue `data` key, which the
 * whitelist pipe answers with a 400.
 */
async function readPixels(request: APIRequestContext, locale: StorefrontLocale) {
  const auth = await signInAsAdmin(request);
  const res = await request.get(PIXELS_URL, { headers: apiHeaders(auth, locale) });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data?: { data?: Record<string, string | undefined> } };
  return body.data?.data ?? {};
}

async function setPixels(
  request: APIRequestContext,
  locale: StorefrontLocale,
  body: Record<string, string>,
): Promise<void> {
  const auth = await signInAsAdmin(request);
  const res = await request.patch(PIXELS_URL, { headers: apiHeaders(auth, locale), data: body });
  expect(res.ok(), `pixel PATCH failed: ${res.status()}`).toBeTruthy();
}

/** Every vendor id the admin can hold, blanked. Empty string clears a pixel. */
const CLEARED = {
  googleAnalyticsId: '',
  metaPixelId: '',
  tiktokPixelId: '',
  snapPixelId: '',
} as const;

async function reloadUntil(page: Page, route: string, assertion: () => Promise<void>) {
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

describeEveryLocale('vendor pixel injection', (locale) => {
  let baseline: ConsoleBaseline;

  test.beforeEach(({ page }) => {
    // The vendor loaders are real external requests that the sandbox may
    // refuse. Chrome reports a refused subresource as a console error naming
    // the resource, which is noise from the network rather than from the page,
    // so it is ignored by URL and by nothing else. The tag ELEMENT is what
    // this spec asserts on; whether the sandbox let it fetch is not the
    // storefront's behaviour.
    baseline = attachConsoleBaseline(page);
  });

  test.afterEach(() => {
    baseline.assertClean({
      ignore: [
        (entry) =>
          typeof entry.url === 'string' &&
          /googletagmanager\.com|connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net/.test(
            entry.url,
          ),
      ],
    });
  });

  test(`no pixel configured means no vendor script anywhere (${locale})`, async ({
    page,
    request,
  }) => {
    const before = await readPixels(request, locale);
    try {
      await setPixels(request, locale, { ...CLEARED });

      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.locator('script[id^="pixel-"]')).toHaveCount(0);
      });
    } finally {
      await setPixels(request, locale, { ...CLEARED, ...before });
    }
  });

  test(`a configured GA4 id injects its loader with that id (${locale})`, async ({
    page,
    request,
  }) => {
    const before = await readPixels(request, locale);
    try {
      await setPixels(request, locale, { ...CLEARED, googleAnalyticsId: SENTINEL_GA4 });

      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.locator('script#pixel-ga4')).toHaveAttribute(
          'src',
          `https://www.googletagmanager.com/gtag/js?id=${SENTINEL_GA4}`,
        );
      });

      // The stub queue is what receives events before the loader arrives. If
      // it is missing, every event fired during page load is lost.
      expect(await page.evaluate(() => typeof (window as never)['gtag'])).toBe('function');
      expect(await page.evaluate(() => Array.isArray((window as never)['dataLayer']))).toBe(true);

      await reloadAndAssertClean(page, `/${locale}/`, baseline, {
        afterReload: async () => {
          // Exactly one, on a fresh load and after the reload seam: a second
          // GA loader double-counts every event after it.
          await expect(page.locator('script#pixel-ga4')).toHaveCount(1);
        },
        ignore: [
          (entry) => typeof entry.url === 'string' && /googletagmanager\.com/.test(entry.url),
        ],
      });
    } finally {
      await setPixels(request, locale, { ...CLEARED, ...before });
    }
  });

  test(`two configured vendors inject one loader each (${locale})`, async ({ page, request }) => {
    const before = await readPixels(request, locale);
    try {
      await setPixels(request, locale, {
        ...CLEARED,
        googleAnalyticsId: SENTINEL_GA4,
        metaPixelId: SENTINEL_META,
      });

      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.locator('script#pixel-meta')).toHaveCount(1);
      });

      await expect(page.locator('script#pixel-ga4')).toHaveCount(1);
      await expect(page.locator('script#pixel-tiktok')).toHaveCount(0);
      await expect(page.locator('script#pixel-snap')).toHaveCount(0);
    } finally {
      await setPixels(request, locale, { ...CLEARED, ...before });
    }
  });

  test(`clearing the id stops the tag loading again (${locale})`, async ({ page, request }) => {
    const before = await readPixels(request, locale);
    try {
      await setPixels(request, locale, { ...CLEARED, googleAnalyticsId: SENTINEL_GA4 });
      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.locator('script#pixel-ga4')).toHaveCount(1);
      });

      await setPixels(request, locale, { ...CLEARED });
      await reloadUntil(page, `/${locale}/`, async () => {
        await expect(page.locator('script[id^="pixel-"]')).toHaveCount(0);
      });
    } finally {
      await setPixels(request, locale, { ...CLEARED, ...before });
    }
  });

  test(`the CSP allows the vendor origins it advertises (${locale})`, async ({ page }) => {
    // A tag allowed in the page but refused by CSP is dead with no visible
    // error, which is the worst shape this feature could ship in.
    const response = await page.goto(`/${locale}/`, { waitUntil: 'domcontentloaded' });
    const csp = response?.headers()['content-security-policy'] ?? '';

    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).toContain('https://connect.facebook.net');
    expect(csp).toContain('https://www.google-analytics.com');
    // Turnstile must survive the addition, or sign-up and the newsletter break.
    expect(csp).toContain('https://challenges.cloudflare.com');
  });
});
