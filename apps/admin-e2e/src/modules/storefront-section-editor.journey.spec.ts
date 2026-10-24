import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * S19 — per-type StorefrontSection editor journey (DR-04 + DR-05).
 *
 * Creates one section of every surviving `SectionType` via the live admin
 * editor UI, then re-opens the saved row and edits it. HERO + PROMOTIONAL_BANNER
 * exercise the asset-picker integration (DR-06 single-select). No
 * `page.route()`, no MSW, no fixtures — every API call hits the backend.
 *
 * Each created section is rolled back via the admin DELETE endpoint in the
 * test's `try/finally` so the seeded `home` page and other journeys stay
 * deterministic across reruns.
 */

test.describe.configure({ mode: 'serial' });

// `e2e-s19-<ts>` keeps every section this spec creates scoped to a fresh
// page slug, so concurrent runs do not collide on the seeded `home` page.
const TEST_PAGE_SLUG = `e2e-s19-${Date.now()}`;

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const RANDOM_UUIDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];

interface AssetLite {
  id: string;
  status: string;
}

async function uploadAsset(baseURL: string, label: string): Promise<AssetLite> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/assets/upload', {
    headers: { Cookie: cookies },
    multipart: {
      file: { name: `${label}.png`, mimeType: 'image/png', buffer: TINY_PNG },
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[storefront-section-editor.journey] upload failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(raw) as { data: AssetLite } | AssetLite;
  return 'data' in body ? body.data : body;
}

async function pollReady(baseURL: string, id: string, timeoutMs = 15_000): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const res = await ctx.get(`/api/v1/admin/assets/${id}`, {
        headers: { Cookie: cookies },
      });
      if (res.ok()) {
        const body = (await res.json()) as { data: { status: string } };
        if (body.data.status === 'READY' || body.data.status === 'FAILED') return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    await ctx.dispose();
  }
}

async function deleteAsset(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/assets/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

async function deleteAllSectionsOnPage(baseURL: string, slug: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const list = await ctx.get(`/api/v1/admin/storefront/pages/${slug}/sections?pageSize=100`, {
    headers: { Cookie: cookies },
  });
  if (list.ok()) {
    const body = (await list.json()) as { data: Array<{ id: string }> };
    for (const row of body.data) {
      await ctx.delete(`/api/v1/admin/storefront/sections/${row.id}`, {
        headers: { Cookie: cookies },
      });
    }
  }
  await ctx.dispose();
}

async function fillTranslatableInput(
  page: import('@playwright/test').Page,
  testId: string,
  value: string,
): Promise<void> {
  // `[data-testid="....-field"]` is set on `<app-input>` / `<app-textarea>` (the
  // Angular component host), not on the native element inside. Playwright's
  // `fill()` requires a native <input> or <textarea>. Piercing one level down
  // with `input, textarea` targets the actual form element.
  const host = page.locator(`[data-testid="${testId}-field"]`).first();
  const native = host.locator('input, textarea').first();
  await native.fill(value);
}

/**
 * Fills a native <input> inside an <app-input> host identified by `data-testid`.
 * `<app-input>` does not forward `data-testid` to the native element, so
 * `page.getByTestId(id).fill()` would target the component host and fail.
 */
async function fillInput(
  page: import('@playwright/test').Page,
  testId: string,
  value: string,
): Promise<void> {
  const host = page.locator(`[data-testid="${testId}"]`).first();
  const native = host.locator('input').first();
  await native.fill(value);
}

/**
 * Drives the shared entity picker: type to search, then commit the first
 * option. Phase B10 replaced the paste-a-UUID rows in both id editors with it
 * (AD14), so a test can no longer type an id that does not exist, which is the
 * whole point of the change.
 */
async function pickFirstOption(
  page: import('@playwright/test').Page,
  testId: string,
  term = '',
): Promise<string> {
  const input = page.locator(`[data-testid="${testId}"]`).first();
  await input.click();
  if (term) await input.fill(term);
  const option = page.locator('li[data-entity-option]').first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  const label = (await option.locator('span').first().innerText()).trim();
  await option.click();
  return label;
}

test.afterAll(async ({ baseURL }) => {
  await deleteAllSectionsOnPage(baseURL!, TEST_PAGE_SLUG);
});

test('HERO — picks an asset, fills required fields, saves and re-edits', async ({
  page,
  baseURL,
}) => {
  const seeded = await uploadAsset(baseURL!, 's19-hero');
  await pollReady(baseURL!, seeded.id);

  try {
    await page.goto(`/storefront/${TEST_PAGE_SLUG}/sections/new`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('storefront-section-editor-page')).toBeVisible();
    await page.getByTestId('section-type-select').selectOption('HERO');
    await expect(page.getByTestId('hero-section-editor')).toBeVisible();

    // Open picker → pick seeded → close.
    await page.getByTestId('hero-asset-pick').click();
    await expect(page.locator('[data-testid="asset-picker"]')).toBeVisible({ timeout: 10_000 });
    await page.locator(`[data-testid="asset-picker-card-${seeded.id}"]`).click();
    await expect(page.locator('[data-testid="asset-picker"]')).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId('hero-asset-id')).toContainText(seeded.id.slice(0, 8));

    await fillTranslatableInput(page, 'hero-eyebrow', 'Summer');
    await fillTranslatableInput(page, 'hero-headline', 'Sun and surf');
    await fillTranslatableInput(page, 'hero-body', 'Discover the new collection');
    await fillTranslatableInput(page, 'hero-cta', 'Shop now');
    await fillInput(page, 'hero-cta-href', '/catalog');

    await injectAxe(page);
    await checkA11y(page, '[data-testid="storefront-section-editor-page"]', {
      detailedReport: false,
    });

    await page.getByTestId('section-editor-save').click();
    await page.waitForURL(`**/storefront/${TEST_PAGE_SLUG}**`, { timeout: 15_000 });
    // Allow extra time for lazy-loaded sections-list page chunk to render.
    await expect(page.locator('[data-testid="storefront-sections-list-page"]')).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await deleteAsset(baseURL!, seeded.id);
  }
});

test('PROMOTIONAL_BANNER — saves with the asset picker', async ({ page, baseURL }) => {
  const seeded = await uploadAsset(baseURL!, 's19-promo');
  await pollReady(baseURL!, seeded.id);

  try {
    await page.goto(`/storefront/${TEST_PAGE_SLUG}/sections/new`, { waitUntil: 'networkidle' });
    await page.getByTestId('section-type-select').selectOption('PROMOTIONAL_BANNER');
    await expect(page.getByTestId('promotional-banner-section-editor')).toBeVisible();

    await page.getByTestId('promo-asset-pick').click();
    await expect(page.locator('[data-testid="asset-picker"]')).toBeVisible({ timeout: 10_000 });
    await page.locator(`[data-testid="asset-picker-card-${seeded.id}"]`).click();
    await expect(page.locator('[data-testid="asset-picker"]')).toBeHidden({ timeout: 5_000 });

    await fillTranslatableInput(page, 'promo-eyebrow', 'Free delivery');
    await fillTranslatableInput(page, 'promo-headline', 'On orders over $50');
    await fillTranslatableInput(page, 'promo-body', 'No promo code required');

    await page.getByTestId('section-editor-save').click();
    await page.waitForURL(`**/storefront/${TEST_PAGE_SLUG}**`, { timeout: 15_000 });
  } finally {
    await deleteAsset(baseURL!, seeded.id);
  }
});

test('CATEGORY_SHOWCASE — picks a real category and saves (B10 / AD14)', async ({ page }) => {
  await page.goto(`/storefront/${TEST_PAGE_SLUG}/sections/new`, { waitUntil: 'networkidle' });
  await page.getByTestId('section-type-select').selectOption('CATEGORY_SHOWCASE');
  await expect(page.getByTestId('category-showcase-section-editor')).toBeVisible();

  // This test used to type RANDOM_UUIDS[0], an id matching no category, and
  // still save. That is exactly the defect AD14 names: the editor accepted a
  // dead reference and only the storefront ever noticed.
  const label = await pickFirstOption(page, 'category-id-0');
  expect(label.length).toBeGreaterThan(0);

  await page.getByTestId('section-editor-save').click();
  await page.waitForURL(`**/storefront/${TEST_PAGE_SLUG}**`, { timeout: 15_000 });
});

test('FEATURED_PRODUCTS — picks a real product and saves with the variant flag', async ({
  page,
}) => {
  await page.goto(`/storefront/${TEST_PAGE_SLUG}/sections/new`, { waitUntil: 'networkidle' });
  await page.getByTestId('section-type-select').selectOption('FEATURED_PRODUCTS');
  await expect(page.getByTestId('featured-products-section-editor')).toBeVisible();

  const label = await pickFirstOption(page, 'product-id-0');
  expect(label.length).toBeGreaterThan(0);

  await page.getByTestId('featured-products-variant').selectOption('grid');
  await page.getByTestId('section-editor-save').click();
  await page.waitForURL(`**/storefront/${TEST_PAGE_SLUG}**`, { timeout: 15_000 });
});

test('CATEGORY_SHOWCASE — flags a dead category id seeded through the API', async ({
  page,
  baseURL,
}) => {
  // Seeded through the API rather than typed, because the picker no longer
  // lets an operator enter an id by hand. This is the rot case: a section
  // configured while the category existed, opened after it was deleted.
  const cookies = getAdminCookies(baseURL!);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const created = await ctx.post(`/api/v1/admin/storefront/pages/${TEST_PAGE_SLUG}/sections`, {
    headers: { Cookie: cookies, 'Content-Type': 'application/json' },
    data: {
      type: 'CATEGORY_SHOWCASE',
      title: { default: 'B10 dead id', en: 'B10 dead id', fr: 'B10 dead id' },
      config: { categoryIds: [RANDOM_UUIDS[0]] },
      sortOrder: 900,
      isVisible: true,
    },
  });
  expect(created.status(), `create response: ${await created.text()}`).toBe(201);
  const sectionId = (await created.json()).data.id as string;

  try {
    await page.goto(`/storefront/sections/${sectionId}/edit`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('category-showcase-section-editor')).toBeVisible();
    await expect(page.getByTestId('category-id-dead-0')).toBeVisible({ timeout: 15_000 });

    // Dirty the form first. Save is disabled on a pristine form anyway, so
    // asserting it straight after load would pass whether or not the dead-id
    // validator exists, and could never fail on the defect it guards.
    await fillTranslatableInput(page, 'category-showcase-heading', 'B10 dirty');

    // The whole point: an edit cannot be saved while the section points at a
    // category that is gone.
    const save = page.getByTestId('section-editor-save').locator('button').first();
    await expect(save).toBeDisabled();
  } finally {
    await ctx.delete(`/api/v1/admin/storefront/sections/${sectionId}`, {
      headers: { Cookie: cookies },
    });
    await ctx.dispose();
  }
});

test('TRUST_SIGNALS — saves with at least one filled pillar', async ({ page }) => {
  await page.goto(`/storefront/${TEST_PAGE_SLUG}/sections/new`, { waitUntil: 'networkidle' });
  await page.getByTestId('section-type-select').selectOption('TRUST_SIGNALS');
  await expect(page.getByTestId('trust-signals-section-editor')).toBeVisible();

  await fillTranslatableInput(page, 'trust-pillar-title-0', 'Fast');
  await fillTranslatableInput(page, 'trust-pillar-subtitle-0', 'Two-day shipping');
  await page.getByTestId('section-editor-save').click();
  await page.waitForURL(`**/storefront/${TEST_PAGE_SLUG}**`, { timeout: 15_000 });
});
