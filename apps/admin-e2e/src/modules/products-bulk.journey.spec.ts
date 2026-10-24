import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R5.7 — Bulk product ops admin journey.
 *
 * Covers `/products` bulk selection + the two bulk dialogs
 * (`Change status` via PATCH /v1/admin/products/bulk/status,
 * `Update prices` via PATCH /v1/admin/products/bulk/prices).
 * Live backend. No `page.route()`, no fixtures.
 *
 * Determinism: every test seeds its own timestamped products via the
 * admin API so concurrent browsers never collide; every seed is deleted
 * in a `finally` block.
 */

function uniqueSlug(label: string): string {
  return `e2e-bulk-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SeededProduct {
  id: string;
  slug: string;
  variantId: string;
  price: number;
}

async function seedProduct(
  baseURL: string,
  overrides: { status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; price?: number } = {},
): Promise<SeededProduct> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const slug = uniqueSlug('p');
  const price = overrides.price ?? 100;
  const res = await ctx.post('/api/v1/admin/products', {
    headers: { Cookie: cookies },
    data: {
      name: { default: `Bulk E2E ${slug}` },
      slug,
      status: overrides.status ?? 'DRAFT',
      variants: [
        {
          sku: `SKU-${slug}`,
          price,
          isDefault: true,
          isActive: true,
        },
      ],
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[products-bulk.journey] seed product failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as {
    data: { id: string; slug: string; variants: Array<{ id: string; price: number }> };
  };
  const variant = data.variants[0];
  return { id: data.id, slug: data.slug, variantId: variant.id, price };
}

async function getProductViaApi(
  baseURL: string,
  id: string,
): Promise<{
  status: string;
  variants: Array<{ id: string; price: number | string }>;
}> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/products/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[products-bulk.journey] get product failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as {
    data: { status: string; variants: Array<{ id: string; price: number | string }> };
  };
  return { status: data.status, variants: data.variants };
}

async function deleteProductViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/products/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

test('/products mounts with row checkboxes and bulk bar initially hidden (a11y-clean)', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await page.goto(`/products?search=${encodeURIComponent(seeded.slug)}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible({
      timeout: 10_000,
    });

    await expect(page.locator('[data-testid="products-select-all"]')).toBeVisible();
    await expect(page.locator(`[data-testid="product-row-checkbox-${seeded.id}"]`)).toBeVisible();
    // The bar keeps its space so rows never shift (finding E1) — present in the
    // DOM, hidden from sight and from the a11y tree.
    const bar = page.locator('[data-testid="products-bulk-bar"]');
    await expect(bar).toHaveCount(1);
    await expect(bar).toBeHidden();
    await expect(bar).toHaveAttribute('aria-hidden', 'true');

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await deleteProductViaApi(baseURL!, seeded.id);
  }
});

test('selecting a row reveals the bulk bar with the correct count', async ({ page, baseURL }) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await page.goto(`/products?search=${encodeURIComponent(seeded.slug)}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

    const rowBox = page
      .locator(`[data-testid="product-row-checkbox-${seeded.id}"] input[type="checkbox"]`)
      .first();
    await rowBox.check();

    const bar = page.locator('[data-testid="products-bulk-bar"]');
    await expect(bar).toBeVisible();
    await expect(page.locator('[data-testid="products-bulk-bar-count"]')).toContainText('1');

    await page.locator('[data-testid="products-bulk-bar-clear"] button').click();
    await expect(bar).toBeHidden();
  } finally {
    await deleteProductViaApi(baseURL!, seeded.id);
  }
});

test('ticking a row does not shift the rows below it (finding E1)', async ({ page, baseURL }) => {
  const a = await seedProduct(baseURL!);
  const b = await seedProduct(baseURL!);
  try {
    await page.goto('/products?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

    // Sort order between the two seeds is not guaranteed; tick the upper row
    // and watch the lower one.
    await expect(page.locator(`[data-testid="product-row-${a.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="product-row-${b.id}"]`)).toBeVisible();
    const aY = (await page.locator(`[data-testid="product-row-${a.id}"]`).boundingBox())!.y;
    const bY = (await page.locator(`[data-testid="product-row-${b.id}"]`).boundingBox())!.y;
    const upper = aY < bY ? a : b;
    const lower = aY < bY ? b : a;

    const lowerRow = page.locator(`[data-testid="product-row-${lower.id}"]`);
    const upperCheckbox = page
      .locator(`[data-testid="product-row-checkbox-${upper.id}"] input[type="checkbox"]`)
      .first();
    // Rows other workers seed can push ours below the fold. `check()` would
    // then scroll, and boxes are viewport-relative, so scroll first.
    await lowerRow.scrollIntoViewIfNeeded();
    await upperCheckbox.scrollIntoViewIfNeeded();
    const before = await lowerRow.boundingBox();
    const targetPoint = await page
      .locator(`[data-testid="product-row-checkbox-${lower.id}"] input[type="checkbox"]`)
      .first()
      .boundingBox();
    expect(before).not.toBeNull();
    expect(targetPoint).not.toBeNull();

    await upperCheckbox.check();
    await expect(page.locator('[data-testid="products-bulk-bar-count"]')).toContainText('1');

    const after = await lowerRow.boundingBox();
    expect(after).not.toBeNull();
    expect(
      Math.abs(after!.y - before!.y),
      'the row below moved when the bulk bar appeared — the next click lands on the wrong row',
    ).toBeLessThanOrEqual(1);

    // Click the coordinates the operator was aiming at before the tick.
    await page.mouse.click(
      targetPoint!.x + targetPoint!.width / 2,
      targetPoint!.y + targetPoint!.height / 2,
    );
    await expect(page.locator('[data-testid="products-bulk-bar-count"]')).toContainText('2');
    await expect(
      page
        .locator(`[data-testid="product-row-checkbox-${lower.id}"] input[type="checkbox"]`)
        .first(),
    ).toBeChecked();
  } finally {
    await deleteProductViaApi(baseURL!, a.id);
    await deleteProductViaApi(baseURL!, b.id);
  }
});

test('bulk status change persists across selected products', async ({ page, baseURL }) => {
  const a = await seedProduct(baseURL!, { status: 'DRAFT' });
  const b = await seedProduct(baseURL!, { status: 'DRAFT' });
  try {
    await page.goto('/products?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

    await page
      .locator(`[data-testid="product-row-checkbox-${a.id}"] input[type="checkbox"]`)
      .first()
      .check();
    await page
      .locator(`[data-testid="product-row-checkbox-${b.id}"] input[type="checkbox"]`)
      .first()
      .check();
    await expect(page.locator('[data-testid="products-bulk-bar-count"]')).toContainText('2');

    await page.locator('[data-testid="products-bulk-bar-status"] button').click();
    await expect(page.locator('[data-testid="bulk-status-dialog"]')).toBeVisible();

    await injectAxe(page);
    await checkA11y(page, '[data-testid="bulk-status-dialog"]', { detailedReport: true });

    const submit = page.locator('[data-testid="bulk-status-submit"] button');
    await expect(submit).toBeDisabled();

    await page.locator('[data-testid="bulk-status-option-ACTIVE"]').check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.locator('[data-testid="bulk-status-dialog"]')).toHaveCount(0, {
      timeout: 10_000,
    });

    const aAfter = await getProductViaApi(baseURL!, a.id);
    const bAfter = await getProductViaApi(baseURL!, b.id);
    expect(aAfter.status).toBe('ACTIVE');
    expect(bAfter.status).toBe('ACTIVE');
  } finally {
    await deleteProductViaApi(baseURL!, a.id);
    await deleteProductViaApi(baseURL!, b.id);
  }
});

test('bulk price update persists default-variant prices for selected products', async ({
  page,
  baseURL,
}) => {
  const a = await seedProduct(baseURL!, { price: 100, status: 'ACTIVE' });
  const b = await seedProduct(baseURL!, { price: 100, status: 'ACTIVE' });
  try {
    await page.goto('/products?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

    await page
      .locator(`[data-testid="product-row-checkbox-${a.id}"] input[type="checkbox"]`)
      .first()
      .check();
    await page
      .locator(`[data-testid="product-row-checkbox-${b.id}"] input[type="checkbox"]`)
      .first()
      .check();

    await page.locator('[data-testid="products-bulk-bar-prices"] button').click();
    await expect(page.locator('[data-testid="bulk-prices-dialog"]')).toBeVisible();

    await injectAxe(page);
    await checkA11y(page, '[data-testid="bulk-prices-dialog"]', { detailedReport: true });

    // `data-testid` on `<app-input>` lands on the wrapper the money-symbol
    // affix migration introduced, not the native control it renders
    // internally; target that.
    const input0 = page.locator('[data-testid="bulk-price-input-0"] input');
    const input1 = page.locator('[data-testid="bulk-price-input-1"] input');
    await input0.fill('149.99');
    await input1.fill('199.99');

    await page.locator('[data-testid="bulk-prices-submit"] button').click();
    await expect(page.locator('[data-testid="bulk-prices-dialog"]')).toHaveCount(0, {
      timeout: 10_000,
    });

    const aAfter = await getProductViaApi(baseURL!, a.id);
    const bAfter = await getProductViaApi(baseURL!, b.id);
    const findPrice = (
      v: Array<{ id: string; price: number | string }>,
      variantId: string,
    ): number => {
      const hit = v.find((row) => row.id === variantId);
      const raw = hit?.price ?? 0;
      return typeof raw === 'string' ? Number(raw) : raw;
    };
    const priceA = findPrice(aAfter.variants, a.variantId);
    const priceB = findPrice(bAfter.variants, b.variantId);
    const seen = new Set([priceA, priceB]);
    expect(seen).toEqual(new Set([149.99, 199.99]));
  } finally {
    await deleteProductViaApi(baseURL!, a.id);
    await deleteProductViaApi(baseURL!, b.id);
  }
});

// ── Request indexing (DR-17 D2) ──────────────────────────────────────────────

test('row-level Request indexing opens the dialog and POSTs to /seo/submit', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedProduct(baseURL!, { status: 'ACTIVE' });
  try {
    await page.goto(`/products?search=${encodeURIComponent(seeded.slug)}`, {
      waitUntil: 'networkidle',
    });
    const rowButton = page.locator(`[data-testid="product-row-indexing-${seeded.id}"]`);
    await expect(rowButton).toBeVisible({ timeout: 10_000 });
    await rowButton.click();

    const dialog = page.locator('[data-testid="seo-submit-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(/re-crawl/i);
    await expect(dialog).not.toContainText(/reindex/i);
    await injectAxe(page);
    await checkA11y(page, '[data-testid="seo-submit-dialog"]', { detailedReport: true });

    const submitResponse = page.waitForResponse(
      (res) => res.url().includes('/v1/admin/seo/submit') && res.request().method() === 'POST',
    );
    await page.locator('[data-testid="seo-submit-confirm"] button').click();
    const res = await submitResponse;
    expect(res.status()).toBe(200);
  } finally {
    await deleteProductViaApi(baseURL!, seeded.id);
  }
});

test('bulk Request indexing (N) submits the selected products', async ({ page, baseURL }) => {
  const a = await seedProduct(baseURL!, { status: 'ACTIVE' });
  const b = await seedProduct(baseURL!, { status: 'ACTIVE' });
  try {
    await page.goto('/products?pageSize=100', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

    await page
      .locator(`[data-testid="product-row-checkbox-${a.id}"] input[type="checkbox"]`)
      .first()
      .check();
    await page
      .locator(`[data-testid="product-row-checkbox-${b.id}"] input[type="checkbox"]`)
      .first()
      .check();

    const bulkButton = page.locator('[data-testid="products-bulk-bar-indexing"]');
    await expect(bulkButton).toContainText('2');
    await bulkButton.click();

    const dialog = page.locator('[data-testid="seo-submit-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const submitResponse = page.waitForResponse(
      (res) => res.url().includes('/v1/admin/seo/submit') && res.request().method() === 'POST',
    );
    await page.locator('[data-testid="seo-submit-confirm"] button').click();
    const res = await submitResponse;
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { targetType: string } };
    expect(body.data.targetType).toBe('products');
  } finally {
    await deleteProductViaApi(baseURL!, a.id);
    await deleteProductViaApi(baseURL!, b.id);
  }
});

test('bulk-price dialog rejects a negative price via the client-side validator', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedProduct(baseURL!, { price: 50 });
  try {
    await page.goto(`/products?search=${encodeURIComponent(seeded.slug)}`, {
      waitUntil: 'networkidle',
    });
    await page
      .locator(`[data-testid="product-row-checkbox-${seeded.id}"] input[type="checkbox"]`)
      .first()
      .check();
    await page.locator('[data-testid="products-bulk-bar-prices"] button').click();
    await expect(page.locator('[data-testid="bulk-prices-dialog"]')).toBeVisible();

    const input = page.locator('[data-testid="bulk-price-input-0"] input');
    await input.fill('-5');
    await input.blur();

    await expect(page.locator('[data-testid="bulk-price-error-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="bulk-prices-submit"] button')).toBeDisabled();
  } finally {
    await deleteProductViaApi(baseURL!, seeded.id);
  }
});
