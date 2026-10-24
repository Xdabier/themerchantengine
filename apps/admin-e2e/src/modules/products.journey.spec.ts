import { checkA11y, injectAxe } from 'axe-playwright';
import { test, expect } from './_auth-fixture';
import { firstIdFromApi, getAdminCookies } from './_helpers';

/**
 * Phase 24.2 — product write journeys.
 *
 * These exercise the real UI forms: navigate → fill → submit → assert
 * persistence by reloading and reading the form back. Every run re-seeds
 * the test DB in globalSetup, so mutations don't carry over between runs.
 *
 * Serialized because the first three specs all operate on the same seeded
 * product row. Parallel workers racing on the same product produce
 * non-deterministic toggle/name state that flakes the suite — the same
 * pattern as currencies.journey.spec.ts (single shared row).
 *
 * Uses the stable seeded product ID `prod-backpack` (Canvas City Backpack)
 * instead of `firstIdFromApi` to avoid a cross-file race with
 * products-bulk.journey.spec.ts which creates + deletes E2E products that
 * temporarily land first in the default API sort order.
 */
test.describe.configure({ mode: 'serial' });

// Stable seeded product ID from prisma/seed.ts — deterministic across re-runs.
const STABLE_PRODUCT_ID = 'prod-backpack';

test('products list search narrows the catalogue, then recovers', async ({ page }) => {
  // QA D3: 845 products with no box. Finding one meant paging or Ctrl-K.
  // Never assume the stable row sits on the unfiltered first page: parallel
  // specs seed products that land first under the default createdAt sort.
  await page.goto('/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-testid="products-search"]').fill('backpack');
  await page.waitForURL(/[?&]search=backpack/, { timeout: 10_000 });
  await expect(page.locator(`[data-testid="product-row-${STABLE_PRODUCT_ID}"]`)).toBeVisible({
    timeout: 15_000,
  });
  const narrowed = await page.locator('tr[data-testid^="product-row-"]').count();
  expect(narrowed).toBeGreaterThan(0);

  await page.locator('[data-testid="products-search"]').fill('zzzz-no-such-product');
  await expect(page.getByText('No products match the current filter.')).toBeVisible({
    timeout: 10_000,
  });

  await page.locator('[data-testid="products-search"]').fill('');
  await page.waitForURL((url) => !url.searchParams.has('search'), { timeout: 10_000 });
  await expect(page.locator('tr[data-testid^="product-row-"]').first()).toBeVisible({
    timeout: 15_000,
  });
  const full = await page.locator('tr[data-testid^="product-row-"]').count();
  expect(full).toBeGreaterThanOrEqual(narrowed);
});

test('edit product name → save → persists after reload', async ({ page }) => {
  const id = STABLE_PRODUCT_ID;
  await page.goto(`/products/${id}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible();

  // Shared InputComponent duplicates its id onto host + native input.
  // Target the native input to avoid strict-mode collisions.
  const nameInput = page.locator('input#product-name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Canvas City Backpack — edited via e2e');

  // Footer save. A loose /Saved/i also matches the "Unsaved changes" footer,
  // which let the reload race the PATCH.
  const patched = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.endsWith(`/v1/admin/products/${id}`) &&
      res.request().method() === 'PATCH',
  );
  await page.locator('[data-testid="product-editor-save"]').click();
  expect((await patched).status()).toBe(200);

  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: '.e2e-review/journey-products-name-saved.png', fullPage: true });

  // Hard-reload to confirm the PATCH actually persisted (not just UI state).
  await page.goto(`/products/${id}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('input#product-name')).toHaveValue(
    'Canvas City Backpack — edited via e2e',
  );
});

test('add variant to product → appears in list', async ({ page }) => {
  const id = STABLE_PRODUCT_ID;
  await page.goto(`/products/${id}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible();

  // Open the Variants tab from the tab-strip.
  await page.getByRole('tab', { name: 'Variants' }).click();
  await expect(page.locator('[data-testid="product-editor-variants"]')).toBeVisible();

  const newSku = `E2E-SKU-${Date.now()}`;

  await page.locator('[data-testid="product-variant-add"]').click();
  await expect(page.locator('[data-testid="variant-dialog"]')).toBeVisible();

  await page.locator('input#variant-sku').fill(newSku);
  await page.locator('input#variant-price').fill('99.99');
  await page.locator('[data-testid="variant-dialog-save"]').click();

  // Dialog closes + a row with the new SKU appears.
  await expect(page.locator('[data-testid="variant-dialog"]')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(newSku).first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: '.e2e-review/journey-products-variant-added.png', fullPage: true });
});

test('toggle product publish status → badge + storefront visibility flip', async ({ page }) => {
  const id = STABLE_PRODUCT_ID;
  await page.goto(`/products/${id}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible();

  const toggle = page.locator('[data-testid="product-publish-toggle"]');
  const initialLabel = (await toggle.textContent())?.trim() ?? '';
  await toggle.click();

  // When publishing a DRAFT/non-ACTIVE product, a confirm dialog appears first.
  // Dismiss it so the mutation proceeds. Unpublish (ACTIVE → DRAFT) has no dialog.
  if (initialLabel === 'Publish') {
    const confirmBtn = page.locator('[data-testid="confirm-dialog-confirm"]');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();
  }

  // Label flips: Publish ↔ Unpublish after the mutation settles.
  await expect(async () => {
    const next = (await toggle.textContent())?.trim() ?? '';
    expect(next).not.toBe(initialLabel);
  }).toPass({ timeout: 10_000 });
  await page.screenshot({
    path: '.e2e-review/journey-products-publish-toggle.png',
    fullPage: true,
  });
});

/**
 * R3 — create product via the three-step wizard. Live backend, real seed
 * data. Step 1 picks a product type from the existing seeded types; step 2
 * fills the name + at least one variant; step 3 optionally attaches a
 * description. Submit hits `POST /v1/admin/products`; we verify persistence
 * by reloading the list page and asserting the new row is there.
 */
test('create product wizard → POST /v1/admin/products → appears in list', async ({
  page,
  baseURL,
}) => {
  const productTypeId = await firstIdFromApi(baseURL!, '/api/v1/admin/product-types?pageSize=1');
  await page.goto('/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

  await page.locator('[data-testid="products-list-create-cta"]').click();
  await expect(page).toHaveURL(/\/products\/new$/);
  await expect(page.locator('[data-testid="product-create-page"]')).toBeVisible();

  // Step 1 — pick product type.
  await page.locator(`[data-testid="product-create-type-option-${productTypeId}"]`).click();
  await page.locator('[data-testid="product-create-step-next"]').click();

  // Step 2 — fill details + one variant.
  const uniqueName = `E2E Runner ${Date.now()}`;
  const uniqueSlug = `e2e-runner-${Date.now()}`;
  await page.locator('input#product-create-name').fill(uniqueName);
  await page.locator('input#product-create-slug').fill(uniqueSlug);
  await page.locator('input#product-create-variant-0-sku').fill(`E2E-${Date.now()}`);
  await page.locator('input#product-create-variant-0-price').fill('149.99');
  await page.locator('[data-testid="product-create-step-next"]').click();

  // Step 3 — (skip media + description, submit).
  await page.locator('[data-testid="product-create-submit"]').click();

  // Post-create: router goes to the edit page for the new product.
  // IDs are CUIDs (base-36: a-z0-9), not UUIDs — regex matches accordingly.
  await expect(page).toHaveURL(/\/products\/[a-z0-9]+\/edit$/, { timeout: 10_000 });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/journey-products-create-done.png', fullPage: true });

  // Reload the list and confirm the new product surfaces.
  // The products list fires an HTTP request on every queryParams emission.
  // Under parallel-worker load, the initial request may 401+retry or a second
  // emission may produce an error response. Use toPass() to retry the full
  // "navigate + assert no error + assert row visible" cycle until it holds for
  // one complete settled page load — up to 20 s total.
  const encodedName = encodeURIComponent(uniqueName);
  await expect(async () => {
    await page.goto(`/products?search=${encodedName}`, { waitUntil: 'networkidle' });
    // If the error banner is visible the page failed to load products — retry.
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(page.getByText(uniqueName).first()).toBeVisible();
  }).toPass({ intervals: [2_000, 3_000, 5_000, 5_000], timeout: 20_000 });
});

test('create product wizard → validation error blocks submit + keeps user on bad step', async ({
  page,
}) => {
  await page.goto('/products/new', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-create-page"]')).toBeVisible();

  // No product type picked; Next is disabled.
  // The data-testid is on the <app-button> host element; the native <button>
  // inside carries the HTML disabled attribute — target it directly so
  // Playwright's toBeDisabled() finds the right element.
  const nextStep1 = page.locator('[data-testid="product-create-step-next"] button');
  await expect(nextStep1).toBeDisabled();
  await page.screenshot({
    path: '.e2e-review/journey-products-create-validation.png',
    fullPage: true,
  });
});

// ── DR-17 D5 — product-detail Search index badge (lazy URL Inspection) ────────

test('product detail Search index badge inspects on click, never on load', async ({ page }) => {
  const id = STABLE_PRODUCT_ID;

  // Count any inspect request from navigation onward — the badge is lazy, so the
  // count must stay 0 until the operator clicks.
  let inspectsBeforeClick = 0;
  page.on('request', (req) => {
    if (req.url().includes('/v1/admin/seo/url-inspection')) inspectsBeforeClick += 1;
  });

  await page.goto(`/products/${id}`, { waitUntil: 'networkidle' });
  const section = page.locator('[data-testid="product-seo-section"]');
  await expect(section).toBeVisible({ timeout: 10_000 });
  const check = page.locator('[data-testid="seo-index-state-check"]');
  await expect(check).toBeVisible();

  // Lazy on-click: nothing inspected on page load (quota protection).
  expect(inspectsBeforeClick).toBe(0);

  const inspectResponse = page.waitForResponse(
    (res) => res.url().includes('/v1/admin/seo/url-inspection') && res.request().method() === 'GET',
  );
  await check.locator('button').click();
  const res = await inspectResponse;
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('no-store');

  // GSC is env-disabled in the e2e backend → the badge degrades (disabled/error),
  // stays present, and never says "reindex".
  await expect(
    page.locator('[data-testid="seo-index-state-disabled"], [data-testid="seo-index-state-error"]'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="seo-index-state"]')).not.toContainText(/reindex/i);

  await injectAxe(page);
  await checkA11y(page, '[data-testid="product-seo-section"]', { detailedReport: true });
});

/**
 * Plan D Phase D6 — the read view renders what the editor stored.
 *
 * Two content generations share the description field, and the wrong treatment
 * is visible in both directions: interpolating HTML showed the operator raw
 * `<p>` and `<li>` text, and HTML-rendering the seeded plain text swallows its
 * paragraph breaks. Both branches are asserted through the real API rather than
 * a fixture, because the branch is chosen from the stored value.
 */
test('the description card renders formatted prose, then plain text with its breaks', async ({
  page,
  request,
  baseURL,
}) => {
  const id = STABLE_PRODUCT_ID;
  const cookies = getAdminCookies(baseURL!);

  async function readDescription(): Promise<unknown> {
    const res = await request.get(`/api/v1/admin/products/${id}`, {
      headers: { Cookie: cookies, 'X-Resolve-Locale': 'false' },
    });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { data: { description: unknown } }).data.description;
  }

  async function writeDescription(description: unknown): Promise<void> {
    const res = await request.patch(`/api/v1/admin/products/${id}`, {
      headers: { Cookie: cookies },
      data: { description },
    });
    expect(res.status(), await res.text()).toBe(200);
  }

  const original = await readDescription();
  try {
    const rich = '<p>Ligne <strong>grasse</strong></p><ul><li>Un</li><li>Deux</li></ul>';
    await writeDescription({ default: rich, en: rich });
    await page.goto(`/products/${id}`, { waitUntil: 'networkidle' });
    const body = page.locator('[data-testid="product-description-body"]');
    await expect(body).toBeVisible({ timeout: 10_000 });
    await expect(body.locator('strong')).toHaveText('grasse');
    await expect(body.locator('li')).toHaveCount(2);
    expect(await body.innerText(), 'the operator must never read the markup').not.toContain('<p');

    const plain = 'Ligne une.\n\nLigne deux.';
    await writeDescription({ default: plain, en: plain });
    await page.goto(`/products/${id}`, { waitUntil: 'networkidle' });
    await expect(body).toBeVisible({ timeout: 10_000 });
    const whiteSpace = await body.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace, 'plain-text breaks must survive as rendered space').toBe('pre-line');
    await expect(body).toContainText('Ligne une.');
    await expect(body).toContainText('Ligne deux.');
  } finally {
    await writeDescription(original ?? { default: '' });
  }
});
