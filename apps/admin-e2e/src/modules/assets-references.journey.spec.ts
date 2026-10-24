import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * S18 — WS2 references dialog + DR-07 hard-delete journey.
 *
 * Three scenarios against the live backend:
 *   1. View references → dialog opens → axe-clean.
 *   2. Click a product reference row → navigate to /products/:id/edit.
 *   3. Direct DELETE /v1/admin/assets/:id while referenced → 409
 *      `ASSET_REFERENCED` with the references payload (defensive backend
 *      gate; the UI path is hidden when references > 0).
 *
 * No `page.route()`, no fixtures, no MSW. Every mutation round-trips
 * through `/api/v1/admin/*` with a fresh admin bearer token.
 */

test.describe.configure({ mode: 'serial' });

// Use prod-iphone (not prod-backpack) to avoid FK-concurrency collisions with
// assets.journey.spec.ts which uses prod-backpack for its own DR-07 test.
// Both specs run concurrently in the full suite and share the same join table
// for their chosen product. Different stable products prevent the race.
const STABLE_PRODUCT_ID = 'prod-iphone';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface AssetLite {
  id: string;
  status: string;
}

interface ProductAssetRef {
  assetId: string;
  sortOrder: number;
  isPrimary: boolean;
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
      `[assets-references.journey] upload failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(raw) as { data: AssetLite } | AssetLite;
  return 'data' in body ? body.data : body;
}

async function deleteAsset(baseURL: string, id: string): Promise<number> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.delete(`/api/v1/admin/assets/${id}`, {
    headers: { Cookie: cookies },
  });
  const status = res.status();
  await ctx.dispose();
  return status;
}

async function fetchAsset(baseURL: string, id: string): Promise<{ status: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/assets/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) throw new Error(`[assets-references.journey] GET failed: ${res.status()}`);
  return (JSON.parse(raw) as { data: { status: string } }).data;
}

async function pollReady(baseURL: string, id: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const a = await fetchAsset(baseURL, id);
    if (a.status === 'READY' || a.status === 'FAILED') return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[assets-references.journey] asset ${id} did not settle`);
}

async function fetchProductAssets(baseURL: string, productId: string): Promise<ProductAssetRef[]> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/products/${productId}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[assets-references.journey] GET /products/${productId} failed: ${res.status()}`,
    );
  }
  const body = JSON.parse(raw) as {
    data: { assets?: Array<{ asset?: { id: string }; sortOrder: number; isPrimary: boolean }> };
  };
  return (body.data.assets ?? [])
    .filter((a): a is { asset: { id: string }; sortOrder: number; isPrimary: boolean } =>
      Boolean(a.asset?.id),
    )
    .map((a) => ({ assetId: a.asset.id, sortOrder: a.sortOrder, isPrimary: a.isPrimary }));
}

async function replaceProductAssets(
  baseURL: string,
  productId: string,
  assets: ProductAssetRef[],
  attempts = 3,
): Promise<void> {
  // Under the full journey suite multiple specs share prod-backpack's
  // ProductAsset join table. Concurrent PATCH transactions can collide:
  // the DB-level P2003 surfaces as 409. Retry up to `attempts` times
  // with a short back-off before surfacing the error.
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 800 * i));
    const cookies = getAdminCookies(baseURL);
    const ctx: APIRequestContext = await request.newContext({ baseURL });
    const res = await ctx.patch(`/api/v1/admin/products/${productId}/assets`, {
      headers: { Cookie: cookies },
      data: { assets },
    });
    lastStatus = res.status();
    await ctx.dispose();
    if (lastStatus === 204) return;
    // 409 is a transient FK-concurrency collision — retry. Any other status is fatal.
    if (lastStatus !== 409) break;
  }
  throw new Error(`[assets-references.journey] PATCH /assets failed: ${lastStatus}`);
}

test('view references dialog renders with the product reference + axe-clean', async ({
  page,
  baseURL,
}) => {
  const asset = await uploadAsset(baseURL!, 's18-view-refs');
  let originalProductAssets: ProductAssetRef[] = [];

  try {
    await pollReady(baseURL!, asset.id);

    originalProductAssets = await fetchProductAssets(baseURL!, STABLE_PRODUCT_ID);
    const nextSort =
      originalProductAssets.length === 0
        ? 0
        : Math.max(...originalProductAssets.map((e) => e.sortOrder)) + 1;
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, [
      ...originalProductAssets,
      { assetId: asset.id, sortOrder: nextSort, isPrimary: false },
    ]);

    await page.goto(`/assets/${asset.id}`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="asset-view-references"]').click();

    const dialog = page.locator('[data-testid="asset-references-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await expect(
      dialog.locator(`[data-testid="asset-references-row-product-${STABLE_PRODUCT_ID}"]`),
    ).toBeVisible();
    await expect(dialog.locator('[data-testid="asset-references-total"]')).toContainText('1');

    await injectAxe(page);
    await checkA11y(page, '[data-testid="asset-references-dialog"]', { detailedReport: false });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  } finally {
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, originalProductAssets);
    await deleteAsset(baseURL!, asset.id);
  }
});

test('clicking a product row navigates to /products/:id/edit', async ({ page, baseURL }) => {
  const asset = await uploadAsset(baseURL!, 's18-click-row');
  let originalProductAssets: ProductAssetRef[] = [];

  try {
    await pollReady(baseURL!, asset.id);

    originalProductAssets = await fetchProductAssets(baseURL!, STABLE_PRODUCT_ID);
    const nextSort =
      originalProductAssets.length === 0
        ? 0
        : Math.max(...originalProductAssets.map((e) => e.sortOrder)) + 1;
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, [
      ...originalProductAssets,
      { assetId: asset.id, sortOrder: nextSort, isPrimary: false },
    ]);

    await page.goto(`/assets/${asset.id}`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="asset-view-references"]').click();
    await expect(page.locator('[data-testid="asset-references-dialog"]')).toBeVisible();

    await page.locator(`[data-testid="asset-references-row-product-${STABLE_PRODUCT_ID}"]`).click();

    await expect(page).toHaveURL(new RegExp(`/products/${STABLE_PRODUCT_ID}/edit`));
  } finally {
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, originalProductAssets);
    await deleteAsset(baseURL!, asset.id);
  }
});

test('DR-07 — direct DELETE while referenced returns 409 ASSET_REFERENCED', async ({ baseURL }) => {
  const asset = await uploadAsset(baseURL!, 's18-dr07');
  let originalProductAssets: ProductAssetRef[] = [];

  try {
    await pollReady(baseURL!, asset.id);

    originalProductAssets = await fetchProductAssets(baseURL!, STABLE_PRODUCT_ID);
    const nextSort =
      originalProductAssets.length === 0
        ? 0
        : Math.max(...originalProductAssets.map((e) => e.sortOrder)) + 1;
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, [
      ...originalProductAssets,
      { assetId: asset.id, sortOrder: nextSort, isPrimary: false },
    ]);

    // Direct API DELETE — must 409 with the references payload.
    const cookies = getAdminCookies(baseURL!);
    const ctx: APIRequestContext = await request.newContext({ baseURL: baseURL! });
    const res = await ctx.delete(`/api/v1/admin/assets/${asset.id}`, {
      headers: { Cookie: cookies },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; details: { references: { total: number } } };
    };
    expect(body.error.code).toBe('ASSET_REFERENCED');
    expect(body.error.details.references.total).toBeGreaterThan(0);
    await ctx.dispose();

    // After clearing references, DELETE succeeds.
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, originalProductAssets);
    originalProductAssets = []; // already cleared
    const afterClear = await deleteAsset(baseURL!, asset.id);
    expect(afterClear).toBe(204);

    // Sanity: GET references on a now-gone asset returns 200 with total: 0.
    // The /references endpoint is a pure aggregation query — it does not
    // assert that the asset row itself still exists. Per docs/admin-api-reference.md
    // §GET /v1/admin/assets/:id/references, the only error codes are 400 (bad
    // type param), 401, and 403. A deleted asset yields empty join results.
    const cookies2 = getAdminCookies(baseURL!);
    const ctx2 = await request.newContext({ baseURL: baseURL! });
    const refRes = await ctx2.get(`/api/v1/admin/assets/${asset.id}/references`, {
      headers: { Cookie: cookies2 },
    });
    expect(refRes.status()).toBe(200);
    const refBody = (await refRes.json()) as { data: { total: number } };
    expect(refBody.data.total).toBe(0);
    await ctx2.dispose();
  } finally {
    if (originalProductAssets.length > 0) {
      await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, originalProductAssets);
    }
    // Best-effort delete in case the test failed before the explicit DELETE.
    await deleteAsset(baseURL!, asset.id).catch(() => undefined);
  }
});
