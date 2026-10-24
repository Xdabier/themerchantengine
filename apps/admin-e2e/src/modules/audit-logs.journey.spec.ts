import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.13 — Audit-log entity drilldown journey.
 *
 * Two scenarios against the live backend:
 *   1. `/audit-logs` mounts + is axe-clean.
 *   2. Seed a fresh audit entry by mutating a stable product's
 *      `metaTitle.default`. Poll the list endpoint until the new entry
 *      surfaces (by `createdAt`). Navigate `/audit-logs`, click the
 *      drilldown row-link, assert the URL lands on
 *      `/audit-logs/product/prod-backpack`, assert the entity page
 *      renders + is axe-clean + surfaces the seeded entry. Teardown
 *      PATCHes the product back to its original `metaTitle`.
 *
 * No `page.route()`, no fixtures, no MSW. Every mutation round-trips
 * through `/api/v1/admin/*` with a fresh admin bearer token.
 */

test.describe.configure({ mode: 'serial' });

const STABLE_PRODUCT_ID = 'prod-backpack';

interface Translatable {
  default: string;
  en?: string;
  ar?: string;
  [locale: string]: string | undefined;
}

// Better Auth sessions are replayable (not single-use) — cache the cookie
// string per baseURL so the seven serial helper calls in this spec each
// do one sign-in rather than seven.
let cachedCookies: { baseURL: string; cookies: string } | null = null;
async function adminCookies(baseURL: string): Promise<string> {
  if (cachedCookies?.baseURL === baseURL) return cachedCookies.cookies;
  const cookies = getAdminCookies(baseURL);
  cachedCookies = { baseURL, cookies };
  return cookies;
}

async function fetchProduct(
  baseURL: string,
  productId: string,
): Promise<{ metaTitle: Translatable | null }> {
  const cookies = await adminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/products/${productId}`, {
    headers: { Cookie: cookies, 'X-Resolve-Locale': 'false' },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[audit-logs.journey] GET /products/${productId} failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(raw) as { data: { metaTitle: Translatable | null } };
  return body.data;
}

async function patchProductMetaTitle(
  baseURL: string,
  productId: string,
  metaTitle: Translatable,
): Promise<void> {
  const cookies = await adminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.patch(`/api/v1/admin/products/${productId}`, {
    headers: { Cookie: cookies },
    data: { metaTitle },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[audit-logs.journey] PATCH /products/${productId} failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
}

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  createdAt: string;
}

async function fetchAuditEntriesForProduct(
  baseURL: string,
  productId: string,
): Promise<AuditEntry[]> {
  const cookies = await adminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/audit-log/product/${productId}?page=1&pageSize=10`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[audit-logs.journey] GET /audit-log/product/${productId} failed: ${res.status()}`,
    );
  }
  const body = JSON.parse(raw) as { data: AuditEntry[] };
  return body.data;
}

async function waitForAuditEntry(
  baseURL: string,
  productId: string,
  sinceIso: string,
  timeoutMs = 10_000,
): Promise<AuditEntry> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await fetchAuditEntriesForProduct(baseURL, productId);
    const fresh = entries.find(
      (e) =>
        e.entityType === 'product' &&
        e.entityId === productId &&
        e.action === 'product.update' &&
        Date.parse(e.createdAt) >= Date.parse(sinceIso),
    );
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `[audit-logs.journey] no fresh audit entry for ${productId} surfaced in ${timeoutMs}ms`,
  );
}

test('audit logs list renders + is axe-clean', async ({ page }) => {
  await page.goto('/audit-logs', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="audit-logs-page"]')).toBeVisible({ timeout: 10_000 });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: false });
});

test('audit timestamps render in the forensic format, not raw UTC ISO', async ({
  page,
  baseURL,
}) => {
  // Guarantee a row: the log can legitimately be empty on a fresh seed.
  const original = await fetchProduct(baseURL!, STABLE_PRODUCT_ID);
  const originalMeta = original.metaTitle ?? { default: 'Backpack' };
  const sinceIso = new Date(Date.now() - 1_000).toISOString();
  await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, {
    ...originalMeta,
    default: `${originalMeta.default} ts-${Date.now()}`,
  });
  await waitForAuditEntry(baseURL!, STABLE_PRODUCT_ID, sinceIso);
  try {
    await page.goto('/audit-logs?entityType=product&pageSize=50', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="audit-logs-page"]')).toBeVisible({ timeout: 10_000 });

    const firstRow = page.locator('tr[data-testid^="audit-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    // `24 May 2026, 03:32:42 GMT+3` — seconds plus an explicit offset, in the
    // store timezone. The old rendering was `2026-05-24 03:32:42Z`.
    // A UTC store renders a bare `GMT`, hence the optional offset.
    await expect(firstRow.locator('td').nth(1)).toHaveText(
      // Three or four letters: `Intl.DateTimeFormat('en-GB')` abbreviates
      // September as "Sept".
      /^\s*\d{1,2} \w{3,4} \d{4}, \d{2}:\d{2}:\d{2} GMT([+-]\d{1,2}(:\d{2})?)?\s*$/,
    );
  } finally {
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, originalMeta);
  }
});

test('drill-down from list row reaches the entity page + is axe-clean', async ({
  page,
  baseURL,
}) => {
  // Snapshot so we can restore on teardown.
  const original = await fetchProduct(baseURL!, STABLE_PRODUCT_ID);
  const originalMeta = original.metaTitle ?? { default: 'Backpack' };
  const suffix = `r613-${Date.now()}`;
  const mutatedMeta: Translatable = {
    ...originalMeta,
    default: `${originalMeta.default} ${suffix}`,
  };
  const sinceIso = new Date(Date.now() - 1_000).toISOString();

  try {
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, mutatedMeta);
    const fresh = await waitForAuditEntry(baseURL!, STABLE_PRODUCT_ID, sinceIso);

    await page.goto(`/audit-logs?entityType=product&pageSize=50`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="audit-logs-page"]')).toBeVisible();

    const rowLink = page.locator(`[data-testid="audit-row-link-${fresh.id}"]`);
    await expect(rowLink).toBeVisible({ timeout: 10_000 });
    await expect(rowLink).toHaveAttribute(
      'aria-label',
      `Drill down to Product ${STABLE_PRODUCT_ID} audit entries`,
    );

    await rowLink.click();
    await expect(page).toHaveURL(new RegExp(`/audit-logs/product/${STABLE_PRODUCT_ID}(?:$|\\?)`));
    await expect(page.locator('[data-testid="audit-log-entity-page"]')).toBeVisible();
    // Humanised, not the raw entityType.
    await expect(page.locator('[data-testid="audit-log-entity-heading"]')).toContainText('Product');
    await expect(page.locator(`[data-testid="audit-entity-row-${fresh.id}"]`)).toBeVisible({
      timeout: 10_000,
    });

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: false });

    // Expand the fresh entry + assert the diff row renders.
    await page.locator(`[data-testid="audit-entity-toggle-${fresh.id}"]`).click();
    await expect(page.locator(`[data-testid="audit-entity-diff-${fresh.id}"]`)).toBeVisible();
  } finally {
    // Restore the original metaTitle so later runs see a clean seed.
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, originalMeta);
  }
});

test('actor search narrows the list to the searched actor', async ({ page, baseURL }) => {
  // The Actor column always showed names while the filter only took a user id,
  // so the operator could read a name and not search for it.
  const original = await fetchProduct(baseURL!, STABLE_PRODUCT_ID);
  const originalMeta = original.metaTitle ?? { default: 'Backpack' };
  const sinceIso = new Date(Date.now() - 1_000).toISOString();

  try {
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, {
      ...originalMeta,
      default: `${originalMeta.default} actor-${Date.now()}`,
    });
    await waitForAuditEntry(baseURL!, STABLE_PRODUCT_ID, sinceIso);

    await page.goto('/audit-logs?pageSize=50', { waitUntil: 'networkidle' });
    const actorInput = page.locator('[data-testid="audit-filter-actor"]');
    await expect(actorInput).toBeVisible();

    // Read the name the Actor column shows, then search for exactly that.
    const firstActor = (
      await page.locator('tr[data-testid^="audit-row-"] td').nth(2).innerText()
    ).trim();
    expect(firstActor.length).toBeGreaterThan(0);

    await actorInput.fill(firstActor.split(' ')[0]);
    await expect(page).toHaveURL(/actor=/, { timeout: 10_000 });
    await expect(page.locator('tr[data-testid^="audit-row-"]').first()).toBeVisible({
      timeout: 10_000,
    });

    const actorCells = await page
      .locator('tr[data-testid^="audit-row-"] td:nth-child(3)')
      .allInnerTexts();
    for (const cell of actorCells) {
      expect(cell.trim()).toContain(firstActor.split(' ')[0]);
    }

    // A term nobody matches empties the table rather than ignoring the filter.
    await actorInput.fill(`nobody-matches-${Date.now()}`);
    await expect(page.locator('tr[data-testid^="audit-row-"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-testid="audit-logs-page"]')).toContainText(
      'No audit entries match',
    );
  } finally {
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, originalMeta);
  }
});

test('the resource cell reads as words while the id stays truncated', async ({ page, baseURL }) => {
  const original = await fetchProduct(baseURL!, STABLE_PRODUCT_ID);
  const originalMeta = original.metaTitle ?? { default: 'Backpack' };
  const sinceIso = new Date(Date.now() - 1_000).toISOString();

  try {
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, {
      ...originalMeta,
      default: `${originalMeta.default} res-${Date.now()}`,
    });
    const fresh = await waitForAuditEntry(baseURL!, STABLE_PRODUCT_ID, sinceIso);

    await page.goto('/audit-logs?entityType=product&pageSize=50', { waitUntil: 'networkidle' });
    const rowLink = page.locator(`[data-testid="audit-row-link-${fresh.id}"]`);
    await expect(rowLink).toBeVisible({ timeout: 10_000 });

    await expect(rowLink).toContainText('Product');
    // The raw snake_case type is gone from the cell, the id is still there.
    await expect(rowLink).not.toContainText('entityType');
    await expect(rowLink).toContainText(STABLE_PRODUCT_ID);
  } finally {
    await patchProductMetaTitle(baseURL!, STABLE_PRODUCT_ID, originalMeta);
  }
});
