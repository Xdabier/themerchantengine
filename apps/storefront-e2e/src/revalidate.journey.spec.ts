import { expect, test } from '@playwright/test';

import { attachConsoleBaseline, type ConsoleBaseline } from './support';

/**
 * Phase S15 — `/api/_internal/revalidate` Nitro route journey.
 *
 * Boots against the real storefront server (no fixtures, no `page.route()`).
 * The storefront test surface ships with a known `STOREFRONT_REVALIDATE_SECRET`
 * (see `apps/storefront-e2e/global-setup.ts`); this suite exercises the auth
 * + dedup + body-validation paths without touching the API.
 *
 * hardening-waived: describeEveryLocale, reloadAndAssertClean. This journey
 * drives a Nitro API route with `request`, never a rendered page, so there is
 * no locale surface to vary and no view state to survive a reload. The console
 * baseline still applies and is attached below.
 */

const REVALIDATE_PATH = '/api/_internal/revalidate';

function uuidV4(): string {
  // Crypto-strong UUID v4 — use Playwright's NodeJS-side crypto via a
  // lightweight emulation since Playwright `request` runs Node-side.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  return randomUUID();
}

const validBody = (
  overrides: Partial<{ paths: string[]; reason: string; eventId: string }> = {},
) => ({
  paths: ['/fr/catalog/product/seed-product', '/en/catalog/product/seed-product'],
  reason: 'product.write',
  eventId: uuidV4(),
  ...overrides,
});

test.describe('storefront S15 revalidate Nitro route', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test.skip(
    !process.env['STOREFRONT_REVALIDATE_SECRET'],
    'STOREFRONT_REVALIDATE_SECRET must be set for the e2e run; skipping when unset',
  );

  test('returns 401 when the secret header is absent', async ({ request }) => {
    const response = await request.post(REVALIDATE_PATH, {
      headers: { 'Content-Type': 'application/json' },
      data: validBody(),
    });
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  test('returns 401 when the secret is wrong', async ({ request }) => {
    const response = await request.post(REVALIDATE_PATH, {
      headers: {
        'Content-Type': 'application/json',
        'X-Revalidate-Secret': 'definitely-not-the-secret-but-equal-length-padding-bytes',
      },
      data: validBody(),
    });
    expect(response.status()).toBe(401);
  });

  test('returns 200 on a valid request and 200 + deduped:true on a replay', async ({ request }) => {
    const secret = process.env['STOREFRONT_REVALIDATE_SECRET']!;
    const body = validBody();

    const first = await request.post(REVALIDATE_PATH, {
      headers: { 'Content-Type': 'application/json', 'X-Revalidate-Secret': secret },
      data: body,
    });
    expect(first.status()).toBe(200);
    const firstJson = (await first.json()) as {
      data?: { invalidated: number; eventId: string; deduped: boolean };
    };
    expect(firstJson.data?.deduped).toBe(false);

    const second = await request.post(REVALIDATE_PATH, {
      headers: { 'Content-Type': 'application/json', 'X-Revalidate-Secret': secret },
      data: body,
    });
    expect(second.status()).toBe(200);
    const secondJson = (await second.json()) as {
      data?: { invalidated: number; eventId: string; deduped: boolean };
    };
    expect(secondJson.data?.deduped).toBe(true);
  });

  test('returns 400 when the body fails Zod validation', async ({ request }) => {
    const secret = process.env['STOREFRONT_REVALIDATE_SECRET']!;
    const response = await request.post(REVALIDATE_PATH, {
      headers: { 'Content-Type': 'application/json', 'X-Revalidate-Secret': secret },
      data: { paths: [], reason: 'product.write', eventId: 'not-a-uuid' },
    });
    expect(response.status()).toBe(400);
    const json = (await response.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('INVALID_BODY');
  });

  test('returns 405 (or method-not-allowed) on GET', async ({ request }) => {
    const response = await request.get(REVALIDATE_PATH);
    // Nitro / h3 returns 405 for the wrong method on a `.post.ts` route.
    // Accept any non-2xx, non-3xx status — the only contract is "GET is
    // not the happy path".
    const status = response.status();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});
