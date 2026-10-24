import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R5.6 — Search Ops admin journey.
 *
 * Covers `/search-ops` (hub + re-index), `/search-ops/synonyms` (list + inline
 * create + delete), `/search-ops/merchandising` (list + inline create +
 * delete + PIN/BOOST refines), `/search-ops/zero-results` (read-only +
 * period picker). Live backend. No `page.route()`, no MSW, no fixtures.
 *
 * Determinism: every write seeds its own `e2e-search-<timestamp>` terms via
 * the admin API so concurrent browsers never collide.
 */

function uniqueTerms(label: string): string[] {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return [`e2e-search-${label}-${stamp}-a`, `e2e-search-${label}-${stamp}-b`];
}

function uniqueQuery(label: string): string {
  return `e2e-search-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function seedSynonym(
  baseURL: string,
  terms: string[],
): Promise<{ id: string; terms: string[] }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/search/synonyms', {
    headers: { Cookie: cookies },
    data: { terms },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[search-ops.journey] seed synonym failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: { id: string; terms: string[] } };
  return data;
}

async function deleteSynonymViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/search/synonyms/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

async function seedRule(
  baseURL: string,
  body: Record<string, unknown>,
): Promise<{ id: string; type: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/search/merchandising', {
    headers: { Cookie: cookies },
    data: body,
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[search-ops.journey] seed rule failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const { data } = JSON.parse(raw) as { data: { id: string; type: string } };
  return data;
}

async function deleteRuleViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/search/merchandising/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

async function firstProductId(baseURL: string): Promise<string> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/products?pageSize=1', {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[search-ops.journey] product list failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: Array<{ id: string }> };
  if (!data[0]) throw new Error('[search-ops.journey] no products seeded for merchandising test');
  return data[0].id;
}

test('/search-ops hub renders the four section cards and is a11y-clean', async ({ page }) => {
  await page.goto('/search-ops', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="search-ops-hub"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="search-ops-card-synonyms"]')).toBeVisible();
  await expect(page.locator('[data-testid="search-ops-card-merchandising"]')).toBeVisible();
  await expect(page.locator('[data-testid="search-ops-card-zero-results"]')).toBeVisible();
  await expect(page.locator('[data-testid="search-ops-card-reindex"]')).toBeVisible();
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('/search-ops Re-index button fires and announces queued count', async ({ page }) => {
  await page.goto('/search-ops', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="search-ops-reindex-button"]').locator('button').click();
  await expect(page.locator('[data-testid="search-ops-reindex-status"]')).toContainText(/queued/i, {
    timeout: 15_000,
  });
});

test('/search-ops/synonyms lists seeded row + a11y + delete flow', async ({ page, baseURL }) => {
  const seed = await seedSynonym(baseURL!, uniqueTerms('list'));
  try {
    await page.goto('/search-ops/synonyms', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="synonyms-list-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="synonym-row-${seed.id}"]`)).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });

    await page
      .locator(`[data-testid="synonym-row-${seed.id}"]`)
      .locator('[data-testid="synonym-delete"]')
      .click();
    await page
      .getByRole('dialog', { name: /Delete synonym group/i })
      .getByRole('button', { name: /^Delete/i })
      .click();
    await expect(page.locator(`[data-testid="synonym-row-${seed.id}"]`)).toBeHidden({
      timeout: 10_000,
    });
  } finally {
    // Best-effort cleanup if the delete above failed.
    await deleteSynonymViaApi(baseURL!, seed.id).catch(() => undefined);
  }
});

test('/search-ops/synonyms inline create rejects single-term input', async ({ page }) => {
  await page.goto('/search-ops/synonyms', { waitUntil: 'networkidle' });
  const chipInput = page.locator('[data-testid="synonym-terms-input"]').locator('input');
  await chipInput.fill('only');
  await chipInput.press('Enter');
  const submit = page.locator('[data-testid="synonym-create-submit"]').locator('button');
  await expect(submit).toBeDisabled();
});

test('/search-ops/synonyms inline create persists a valid group', async ({ page, baseURL }) => {
  const terms = uniqueTerms('create');
  await page.goto('/search-ops/synonyms', { waitUntil: 'networkidle' });
  const chipInput = page.locator('[data-testid="synonym-terms-input"]').locator('input');
  for (const t of terms) {
    await chipInput.fill(t);
    await chipInput.press('Enter');
  }
  await page.locator('[data-testid="synonym-create-submit"]').locator('button').click();
  await expect(page.locator('[data-testid="synonym-create-status"]')).toContainText(/created/i, {
    timeout: 10_000,
  });

  // Cleanup via the admin API
  const cookies = getAdminCookies(baseURL!);
  const ctx = await request.newContext({ baseURL });
  const listRes = await ctx.get('/api/v1/admin/search/synonyms?pageSize=100', {
    headers: { Cookie: cookies },
  });
  const { data } = (await listRes.json()) as { data: Array<{ id: string; terms: string[] }> };
  await ctx.dispose();
  const row = data.find((r) => r.terms.includes(terms[0]));
  if (row) await deleteSynonymViaApi(baseURL!, row.id);
});

test('/search-ops/merchandising lists seeded row + a11y', async ({ page, baseURL }) => {
  const productId = await firstProductId(baseURL!);
  const seed = await seedRule(baseURL!, {
    type: 'BOOST',
    productId,
    query: uniqueQuery('list'),
    priority: 5,
  });
  try {
    await page.goto('/search-ops/merchandising', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="merchandising-list-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="rule-row-${seed.id}"]`)).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deleteRuleViaApi(baseURL!, seed.id);
  }
});

test('/search-ops/merchandising inline create refines PIN and BOOST', async ({ page, baseURL }) => {
  const productId = await firstProductId(baseURL!);
  await page.goto('/search-ops/merchandising', { waitUntil: 'networkidle' });

  // PIN without position → submit stays disabled
  await page.locator('[data-testid="rule-type-select"]').selectOption('PIN');
  await page.locator('[data-testid="rule-productId"]').locator('input').fill(productId);
  let submit = page.locator('[data-testid="rule-create-submit"]').locator('button');
  await expect(submit).toBeDisabled();

  // Add position → submit enables
  await page.locator('[data-testid="rule-position"]').locator('input').fill('2');
  await expect(submit).toBeEnabled();

  // Switch to BOOST without productId → submit disables again
  await page.locator('[data-testid="rule-type-select"]').selectOption('BOOST');
  await page.locator('[data-testid="rule-productId"]').locator('input').fill('');
  submit = page.locator('[data-testid="rule-create-submit"]').locator('button');
  await expect(submit).toBeDisabled();
});

test('/search-ops/merchandising inline create persists a BOOST rule', async ({ page, baseURL }) => {
  const productId = await firstProductId(baseURL!);
  const q = uniqueQuery('boost');
  await page.goto('/search-ops/merchandising', { waitUntil: 'networkidle' });

  await page.locator('[data-testid="rule-type-select"]').selectOption('BOOST');
  await page.locator('[data-testid="rule-query"]').locator('input').fill(q);
  await page.locator('[data-testid="rule-productId"]').locator('input').fill(productId);
  await page.locator('[data-testid="rule-priority"]').locator('input').fill('7');

  await page.locator('[data-testid="rule-create-submit"]').locator('button').click();
  await expect(page.locator('[data-testid="rule-create-status"]')).toContainText(/created/i, {
    timeout: 10_000,
  });

  // Cleanup via the admin API
  const cookies = getAdminCookies(baseURL!);
  const ctx = await request.newContext({ baseURL });
  const listRes = await ctx.get('/api/v1/admin/search/merchandising?pageSize=100', {
    headers: { Cookie: cookies },
  });
  const { data } = (await listRes.json()) as { data: Array<{ id: string; query: string | null }> };
  await ctx.dispose();
  const row = data.find((r) => r.query === q);
  if (row) await deleteRuleViaApi(baseURL!, row.id);
});

test('/search-ops/zero-results mounts + period picker URL-binds + a11y', async ({ page }) => {
  await page.goto('/search-ops/zero-results', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="zero-results-page"]')).toBeVisible({ timeout: 10_000 });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });

  await page.locator('[data-testid="zero-results-period-7"]').click();
  await expect(page).toHaveURL(/period=7/);

  await page.locator('[data-testid="zero-results-period-90"]').click();
  await expect(page).toHaveURL(/period=90/);
});
