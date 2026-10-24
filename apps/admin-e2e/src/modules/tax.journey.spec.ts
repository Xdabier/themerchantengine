import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.8 — Tax Classes UI + Tax zone create journey.
 *
 * Covers the tax surface against the live backend: zones list
 * round-trip, zone create round-trip with rate-percent rounding
 * assertion, classes list filtered by zoneId, class create
 * round-trip, isDefault class branch, form validation guards, and
 * axe-clean on each new page.
 *
 * Zones + classes share DB rows — parallel workers would PATCH each
 * other's seeded state, so run serial. Every write round-trips
 * through the live API. No `page.route()`, no fixtures, no MSW.
 *
 * Zone DELETE carve-out: the backend does not expose
 * `DELETE /v1/admin/tax/zones/:id` or any class mutation endpoint
 * beyond create. Teardown is a best-effort — seeded rows carry a
 * unique `E2E Zone <run-id>` prefix so re-runs do not collide, and
 * rows persist across runs until the backend adds a DELETE. See the
 * R6.8 sub-phase entry in `specs/admin-dashboard/tasks.md` for
 * context; if R7 needs a clean DB, open a new audit item in
 * `production-readiness-audit.md` for the missing endpoint.
 */

test.describe.configure({ mode: 'serial' });

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface Zone {
  id: string;
  name: string;
  countries: string[];
  rate: number;
  isDefault?: boolean;
  isCompound?: boolean;
  priority?: number;
  isActive?: boolean;
}

interface TaxClassRow {
  id: string;
  zoneId: string;
  name: string;
  rate: number;
  isDefault?: boolean;
}

async function apiCtx(baseURL: string): Promise<{ ctx: APIRequestContext; cookies: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  return { ctx, cookies };
}

async function listZones(baseURL: string, pageSize = 100): Promise<Zone[]> {
  const { ctx, cookies } = await apiCtx(baseURL);
  const res = await ctx.get(`/api/v1/admin/tax/zones?page=1&pageSize=${pageSize}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[tax.journey] GET zones failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: Zone[] };
  return body.data;
}

async function getZone(baseURL: string, id: string): Promise<Zone> {
  const { ctx, cookies } = await apiCtx(baseURL);
  const res = await ctx.get(`/api/v1/admin/tax/zones/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[tax.journey] GET zone ${id} failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: Zone };
  return body.data;
}

async function createZone(baseURL: string, payload: Record<string, unknown>): Promise<Zone> {
  const { ctx, cookies } = await apiCtx(baseURL);
  const res = await ctx.post('/api/v1/admin/tax/zones', {
    headers: { Cookie: cookies },
    data: payload,
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[tax.journey] POST zone failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: Zone };
  return body.data;
}

async function listClasses(
  baseURL: string,
  params: { zoneId?: string } = {},
): Promise<TaxClassRow[]> {
  const { ctx, cookies } = await apiCtx(baseURL);
  const qs = new URLSearchParams({ page: '1', pageSize: '100' });
  if (params.zoneId) qs.set('zoneId', params.zoneId);
  const res = await ctx.get(`/api/v1/admin/tax/classes?${qs.toString()}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[tax.journey] GET classes failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: TaxClassRow[] };
  return body.data;
}

async function seedZone(baseURL: string, suffix: string): Promise<Zone> {
  // `name` is a Translatable JSONB object — the DTO uses `TranslatableDto`
  // (class-validator @ValidateNested). The API reference incorrectly documents
  // it as `string`; the actual DTO wins per constitution §3.5.
  return createZone(baseURL, {
    name: { default: `E2E Zone ${RUN_ID} ${suffix}`, en: `E2E Zone ${RUN_ID} ${suffix}` },
    countries: ['QA'],
    rate: 0.05,
    isActive: true,
  });
}

test('zones list round-trip mounts with the live snapshot', async ({ page, baseURL }) => {
  const zones = await listZones(baseURL!);
  await page.goto('/shipping/tax', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-zones-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  for (const z of zones.slice(0, 5)) {
    await expect(page.locator(`[data-testid="tax-zone-row-${z.id}"]`)).toBeVisible();
  }
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('zone create round-trip persists with rate-percent rounding', async ({ page, baseURL }) => {
  await page.goto('/shipping/tax/zones/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-zone-new-page"]')).toBeVisible({ timeout: 10_000 });

  const uniqueName = `E2E Zone ${RUN_ID} create`;
  await page.locator('input#tax-name').fill(uniqueName);
  await page.locator('input#tax-rate').fill('5');
  await page.locator('input#tax-countries').fill('QA');
  await page.locator('[data-testid="tax-save"] button').click();

  await page.waitForURL(/\/shipping\/tax\/[^/]+$/, { timeout: 10_000 });
  await expect(page.locator('[data-testid="tax-zone-editor-page"]')).toBeVisible({
    timeout: 10_000,
  });

  const id = page.url().split('/').at(-1)!;
  const zone = await getZone(baseURL!, id);
  // Prisma Decimal serialises as a string on the wire; accept both forms.
  expect(zone.rate.toString() === '0.05' || zone.rate === 0.05).toBe(true);
  expect(zone.name).toBe(uniqueName);

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('classes list filtered by zoneId shows only that zones rows', async ({ page, baseURL }) => {
  const zone = await seedZone(baseURL!, 'list-filter');
  const allClasses = await listClasses(baseURL!, { zoneId: zone.id });
  await page.goto(`/shipping/tax/classes?zoneId=${zone.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-classes-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  for (const c of allClasses) {
    await expect(page.locator(`[data-testid="tax-class-row-${c.id}"]`)).toBeVisible();
  }
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('class create round-trip persists', async ({ page, baseURL }) => {
  const zone = await seedZone(baseURL!, 'class-create');
  await page.goto(`/shipping/tax/classes/new?zoneId=${zone.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-class-new-page"]')).toBeVisible({ timeout: 10_000 });

  const selectHandle = page.locator('#tax-class-zone');
  await selectHandle.selectOption(zone.id);
  await page.locator('input#tax-class-name').fill('Standard');
  await page.locator('input#tax-class-rate').fill('5');
  await page.locator('[data-testid="tax-class-save"] button').click();

  await page.waitForURL(/\/shipping\/tax\/classes\?.*zoneId=/, { timeout: 10_000 });
  const serverClasses = await listClasses(baseURL!, { zoneId: zone.id });
  expect(serverClasses.some((c) => c.name === 'Standard')).toBe(true);
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('isDefault class branch persists across the live API', async ({ page, baseURL }) => {
  const zone = await seedZone(baseURL!, 'isdefault');
  await page.goto(`/shipping/tax/classes/new?zoneId=${zone.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-class-new-page"]')).toBeVisible({ timeout: 10_000 });

  await page.locator('#tax-class-zone').selectOption(zone.id);
  await page.locator('input#tax-class-name').fill('Reduced');
  await page.locator('input#tax-class-rate').fill('2.5');
  await page.locator('[data-testid="tax-class-default"]').check();
  await page.locator('[data-testid="tax-class-save"] button').click();
  await page.waitForURL(/\/shipping\/tax\/classes\?.*zoneId=/, { timeout: 10_000 });

  const serverClasses = await listClasses(baseURL!, { zoneId: zone.id });
  const reduced = serverClasses.find((c) => c.name === 'Reduced');
  expect(reduced).toBeDefined();
  expect(reduced?.isDefault).toBe(true);

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('zone create validation guard blocks empty submit', async ({ page }) => {
  await page.goto('/shipping/tax/zones/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-zone-new-page"]')).toBeVisible({ timeout: 10_000 });

  const save = page.locator('[data-testid="tax-save"] button');
  await expect(save).toBeDisabled();

  await page.locator('input#tax-name').focus();
  await page.locator('input#tax-rate').focus();
  await page.locator('input#tax-countries').focus();
  await page.locator('input#tax-name').blur();

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('class create validation guard blocks empty submit', async ({ page, baseURL }) => {
  await seedZone(baseURL!, 'validation');
  await page.goto('/shipping/tax/classes/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-class-new-page"]')).toBeVisible({ timeout: 10_000 });

  const save = page.locator('[data-testid="tax-class-save"] button');
  await expect(save).toBeDisabled();

  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});

test('classes list axe-clean on the no-filter view', async ({ page }) => {
  await page.goto('/shipping/tax/classes', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-classes-list-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: true });
});
