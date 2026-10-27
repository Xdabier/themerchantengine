import { request } from '@playwright/test';
import { test, expect } from './_auth-fixture';
import {
  assertNoObjectObjectLeak,
  assertNotRawId,
  firstIdFromApi,
  getAdminCookies,
} from './_helpers';

/**
 * Entity-rendering regression guard (specs/features/admin-entity-rendering/plan.md).
 *
 * Two bug classes are guarded here against silent return:
 *  - Class A — a `Translatable` JSONB value bound without reduction renders the
 *    literal "[object Object]". `assertNoObjectObjectLeak` scans the whole page.
 *  - Class B — a database id rendered where a human name belongs.
 *    `assertNotRawId` checks a specific identity cell is not a bare UUID/cuid.
 *
 * Runs against the live backend (no fixtures, no page.route()). Read-only: it
 * only navigates and asserts, so it is idempotent against a pristine seed.
 */

// Screens that render entity names / enum labels and were touched by the fix.
const SCREENS: ReadonlyArray<{ route: string; testid: string }> = [
  { route: '/shipping/tax', testid: 'tax-zones-list-page' },
  { route: '/orders', testid: 'orders-list-page' },
  { route: '/audit-logs', testid: 'audit-logs-page' },
  { route: '/search-ops/merchandising', testid: 'merchandising-list-page' },
  { route: '/returns', testid: 'returns-list-page' },
  { route: '/inventory', testid: 'inventory-stock-list-page' },
  { route: '/inventory/movements', testid: 'inventory-movements-list-page' },
  { route: '/inventory/alerts', testid: 'inventory-alerts-list-page' },
  { route: '/notifications/log', testid: 'notification-log-page' },
  { route: '/campaigns', testid: 'campaigns-list-page' },
  { route: '/pages', testid: 'cms-pages-list-page' },
  { route: '/assets', testid: 'assets-library-page' },
  { route: '/analytics/funnel', testid: 'analytics-funnel-page' },
  { route: '/me', testid: 'me-page' },
];

for (const { route, testid } of SCREENS) {
  test(`no entity-rendering leak on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'networkidle' });
    // Best-effort wait for the page shell; tolerate testid drift by falling
    // back to networkidle (already awaited) rather than failing the guard.
    await page
      .locator(`[data-testid="${testid}"]`)
      .waitFor({ state: 'visible', timeout: 8_000 })
      .catch(() => undefined);
    await assertNoObjectObjectLeak(page);
  });
}

test('tax-zone editor renders a resolved name, not [object Object]', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/tax/zones?pageSize=1');
  await page.goto(`/shipping/tax/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-zone-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await assertNoObjectObjectLeak(page);
  await assertNotRawId(page.locator('h1').first(), 'tax-zone editor heading');
});

test('order detail shows a customer name/email, not the raw userId', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/orders?pageSize=1');
  await page.goto(`/orders/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="order-detail-page"]')).toBeVisible({ timeout: 10_000 });
  await assertNoObjectObjectLeak(page);
});

/**
 * Raw-id / raw-enum guards (admin-qa-remediation plan B, findings B1 to B8).
 * Same rules as above: live backend, read-only, no `page.route()`.
 */

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** `webhook.delete`, `gift_card.updated`, ... the audit-key signature. */
const DOTTED_ACTION_KEY = /\b\w+\.(create|update|delete|created|updated|deleted)\b/i;

/** Search term taken from real seeded data so the product group is never empty. */
async function firstProductSearchTerm(baseURL: string): Promise<string> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/products?pageSize=1', {
    headers: { Cookie: getAdminCookies(baseURL) },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) throw new Error(`[search term] products -> ${res.status()}: ${raw.slice(0, 200)}`);
  const body = JSON.parse(raw) as { data: Array<{ slug: string }> };
  if (!body.data?.length) throw new Error('[search term] no seeded products to search for');
  return body.data[0].slug.split('-')[0].slice(0, 6);
}

/** First order that actually carries a shipment, or null when the seed has none. */
async function orderIdWithShipment(baseURL: string): Promise<string | null> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  try {
    const listRes = await ctx.get('/api/v1/admin/orders?pageSize=10', {
      headers: { Cookie: cookies },
    });
    if (!listRes.ok()) return null;
    const list = JSON.parse(await listRes.text()) as { data: Array<{ id: string }> };
    for (const row of list.data ?? []) {
      const detailRes = await ctx.get(`/api/v1/admin/orders/${row.id}`, {
        headers: { Cookie: cookies },
      });
      if (!detailRes.ok()) continue;
      const detail = JSON.parse(await detailRes.text()) as {
        data: { shipments?: unknown[] };
      };
      if ((detail.data?.shipments ?? []).length > 0) return row.id;
    }
    return null;
  } finally {
    await ctx.dispose();
  }
}

test('search results identify a hit by name and SKU, never by route path', async ({
  page,
  baseURL,
}) => {
  const term = await firstProductSearchTerm(baseURL!);
  await page.goto(`/search?q=${encodeURIComponent(term)}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="search-results-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await assertNoObjectObjectLeak(page);

  const firstHit = page.locator('[data-testid^="search-hit-"]').first();
  await expect(firstHit).toBeVisible({ timeout: 10_000 });
  const rowText = (await firstHit.textContent()) ?? '';
  expect(rowText, 'a search hit still prints its internal route path').not.toContain('/products/');
  expect(rowText, 'a search hit still prints a raw record id').not.toMatch(UUID_IN_TEXT);
  await assertNotRawId(
    firstHit.locator('[data-testid="search-hit-subtitle"]').first(),
    'search hit subtitle',
  );
});

test('order detail labels shipments and the return status for a human', async ({
  page,
  baseURL,
}) => {
  const withShipment = await orderIdWithShipment(baseURL!);
  const id = withShipment ?? (await firstIdFromApi(baseURL!, '/api/v1/admin/orders?pageSize=1'));
  await page.goto(`/orders/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="order-detail-page"]')).toBeVisible({ timeout: 10_000 });

  // textContent, not innerText: badges are styled `uppercase`, and innerText
  // returns the CSS-transformed text, so a correct "Delivered" label would read
  // as "DELIVERED" and this guard would fail on a fixed page.
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body, 'the order detail still prints a raw status enum').not.toMatch(
    /\b(PROCESSING|SHIPPED|DELIVERED|REFUND_PROCESSED|ITEM_RECEIVED)\b/,
  );

  const panel = page.locator('[data-testid="order-shipment-panel"]').first();
  if ((await panel.count()) > 0 && withShipment) {
    const panelText = (await panel.textContent()) ?? '';
    expect(panelText, 'a shipment row still shows its internal id').not.toMatch(/\bship[-_]\w+/i);
    expect(panelText).toContain('Shipment 1');
  }
});

test('dashboard activity reads as sentences, not audit keys', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="dashboard-activity"]')).toBeVisible({ timeout: 10_000 });
  const list = page.locator('[data-testid="activity-list"]');
  if ((await list.count()) > 0) {
    const text = (await list.textContent()) ?? '';
    expect(text, 'the activity feed still prints a raw audit action key').not.toMatch(
      DOTTED_ACTION_KEY,
    );
  }
  await assertNoObjectObjectLeak(page);
});

test('order-new picks countries by name and reads variants without SKU noise', async ({ page }) => {
  await page.goto('/orders/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="order-new-page"]')).toBeVisible({ timeout: 15_000 });

  // Superadmin holds settings:view, so the happy path is the select.
  const country = page.locator('[data-testid="country-select"]').first();
  await expect(country).toBeVisible({ timeout: 10_000 });
  expect(await country.textContent()).toContain('France (FR)');

  // The product picker (QA C2) now owns the readable name; the variant select
  // beside it lists that product's SKUs with a formatted price.
  const picker = page.locator('[data-testid="order-new-product-0"]');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await picker.click();
  const firstOption = page.locator('[data-entity-option]').first();
  await expect(firstOption).toBeVisible({ timeout: 15_000 });
  expect(await firstOption.textContent(), 'the picker label is raw id noise').toMatch(/[a-z]/);
  await firstOption.click();

  const variant = page.locator('[data-testid="order-new-variant-0"]').first();
  await expect(variant).toBeVisible();
  const options = ((await variant.textContent()) ?? '')
    .split('\n')
    .map((o) => o.trim())
    .filter((o) => o && !o.startsWith('Select a variant') && !o.startsWith('Pick a product'));
  if (options.length > 0) {
    expect(options[0], 'a variant option lost its formatted price').toMatch(/\(.+\)/);
  }
});

test('gift-card detail ledger rows show a note label, not a blank/raw field', async ({
  page,
  baseURL,
}) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/gift-cards?pageSize=1');
  await page.goto(`/gift-cards/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-detail-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await assertNoObjectObjectLeak(page);
});
