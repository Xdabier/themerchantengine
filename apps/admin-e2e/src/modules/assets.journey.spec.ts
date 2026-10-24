import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.12 + S18.7 — Assets delete + DR-07 references gate journey.
 *
 * Three scenarios against the live backend:
 *   1. List mount + axe clean.
 *   2. Upload → detail → delete happy round-trip (no references).
 *   3. Attach the uploaded asset to a seeded product → detail page →
 *      destructive CTA hidden, "View references" CTA exposed, no DELETE
 *      request can fire from the UI. The DR-07 409 path itself lives in
 *      `assets-references.journey.spec.ts`.
 *
 * No `page.route()`, no fixtures, no MSW. Every mutation round-trips
 * through `/api/v1/admin/*` with a fresh admin bearer token.
 */

test.describe.configure({ mode: 'serial' });

// Seeded product id from prisma/seed.ts — shared with products.journey.spec.ts.
const STABLE_PRODUCT_ID = 'prod-backpack';

/**
 * 67-byte 1×1 transparent PNG. Backend validates magic bytes
 * (`apps/api/src/modules/assets/assets.service.ts:229-253`) so the file
 * must start with the canonical PNG signature + a real IHDR.
 */
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

async function uploadAsset(baseURL: string): Promise<AssetLite> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/assets/upload', {
    headers: { Cookie: cookies },
    multipart: {
      file: { name: 'r612.png', mimeType: 'image/png', buffer: TINY_PNG },
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[assets.journey] upload failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: AssetLite } | AssetLite;
  return 'data' in body ? body.data : body;
}

async function deleteAsset(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.delete(`/api/v1/admin/assets/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
  if (
    res.status() !== 204 &&
    res.status() !== 400 &&
    res.status() !== 404 &&
    res.status() !== 409
  ) {
    throw new Error(`[assets.journey] DELETE /assets/${id} failed: ${res.status()}`);
  }
}

async function fetchAsset(
  baseURL: string,
  id: string,
): Promise<{ id: string; status: string; usage: { total: number } }> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/assets/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[assets.journey] GET /assets/${id} failed: ${res.status()}`);
  }
  const body = JSON.parse(raw) as {
    data: { id: string; status: string; usage: { total: number } };
  };
  return body.data;
}

async function pollAssetReady(baseURL: string, id: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'UNKNOWN';
  while (Date.now() < deadline) {
    const asset = await fetchAsset(baseURL, id);
    lastStatus = asset.status;
    if (asset.status === 'READY' || asset.status === 'FAILED') return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[assets.journey] asset ${id} did not settle (last=${lastStatus})`);
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
    throw new Error(`[assets.journey] GET /products/${productId} failed: ${res.status()}`);
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
  // Always call PATCH (even when assets is []) so that cleanup reliably clears
  // any references this test added during the run. The early-return for empty
  // was removed because it prevented cleanup when originalProductAssets was [] —
  // the test still adds a reference that must be removed in the finally block.
  //
  // Under the full journey suite multiple specs share prod-backpack's
  // ProductAsset join table. Concurrent PATCH transactions can collide:
  // the DB-level P2003 surfaces as 409. Retry up to `attempts` times
  // with a short back-off before surfacing the error.
  let lastStatus = 0;
  let lastBody = '';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 800 * i));
    const cookies = getAdminCookies(baseURL);
    const ctx: APIRequestContext = await request.newContext({ baseURL });
    const res = await ctx.patch(`/api/v1/admin/products/${productId}/assets`, {
      headers: { Cookie: cookies },
      data: { assets },
    });
    lastStatus = res.status();
    lastBody = await res.text();
    await ctx.dispose();
    if (lastStatus === 204) return;
    // 409 is a transient FK-concurrency collision — retry. Any other status is fatal.
    if (lastStatus !== 409) break;
  }
  throw new Error(
    `[assets.journey] PATCH /products/${productId}/assets failed: ${lastStatus} ${lastBody.slice(0, 200)}`,
  );
}

test('assets library renders + is axe-clean', async ({ page }) => {
  await page.goto('/assets', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="assets-library-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: false });
});

test('upload → detail → delete happy round-trip', async ({ page, baseURL }) => {
  const asset = await uploadAsset(baseURL!);
  let cleanupId: string | null = asset.id;

  try {
    await pollAssetReady(baseURL!, asset.id);

    await page.goto(`/assets/${asset.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="asset-detail-page"]')).toBeVisible();

    // AV3 — asset detail must be axe-clean with the new "Download original"
    // button + 5-minute TTL help text. Catches contrast / disabled-state
    // announcement regressions on the detail surface.
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: false });

    const deleteBtn = page.locator('[data-testid="asset-delete"]');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeEnabled();

    await deleteBtn.click();
    const confirm = page.locator('[data-testid="confirm-dialog-confirm"]');
    await expect(confirm).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/admin/assets/${asset.id}`) && r.request().method() === 'DELETE',
      { timeout: 15_000 },
    );
    await confirm.click();
    const delRes = await deleteResponse;
    expect(delRes.status()).toBe(204);

    await expect(page).toHaveURL(/\/assets\/?($|\?)/);
    cleanupId = null;
  } finally {
    if (cleanupId) {
      await deleteAsset(baseURL!, cleanupId);
    }
  }
});

test('AV3 — Download original button hits the signed-URL endpoint + opens it', async ({
  page,
  baseURL,
}) => {
  const asset = await uploadAsset(baseURL!);
  let cleanupId: string | null = asset.id;

  try {
    await pollAssetReady(baseURL!, asset.id);

    await page.goto(`/assets/${asset.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="asset-detail-page"]')).toBeVisible();

    // Button surfaces for assets:view operators with a non-null
    // originalStoragePath, with the 5-minute TTL help text alongside.
    const downloadBtn = page.locator('[data-testid="asset-download-original"]');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toBeEnabled();
    await expect(page.locator('#asset-download-original-help')).toContainText(/5 minutes/i);

    // Spy on `window.open` so the real navigation does not pop a tab in CI.
    await page.addInitScript(() => {
      (window as unknown as { __opened?: string[] }).__opened = [];
      const orig = window.open.bind(window);
      window.open = ((url?: string | URL): Window | null => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null as unknown as Window | null;
      }) as typeof orig;
    });
    // Re-open the page so the init script runs against the live navigation.
    await page.goto(`/assets/${asset.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="asset-download-original"]')).toBeVisible();

    const signedUrlResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/admin/assets/${asset.id}/original-url`) &&
        r.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.locator('[data-testid="asset-download-original"]').click();
    const signedRes = await signedUrlResponse;
    expect(signedRes.status()).toBe(200);
    const body = (await signedRes.json()) as { data: { url: string; expiresAt: string } };
    expect(body.data.url).toMatch(/^https?:\/\//);
    expect(body.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // window.open was invoked with the signed URL.
    const opened = await page.evaluate(
      () => (window as unknown as { __opened?: string[] }).__opened ?? [],
    );
    expect(opened).toContain(body.data.url);
  } finally {
    if (cleanupId) {
      await deleteAsset(baseURL!, cleanupId);
      cleanupId = null;
    }
  }
});

// ── AU0 — library-page dropzone + upload queue ───────────────────────────────

test('AU0 — drop a file on /assets uploads it via the queue and refreshes the grid', async ({
  page,
  baseURL,
}) => {
  let cleanupId: string | null = null;

  try {
    await page.goto('/assets', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="assets-library-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="assets-upload-block"]')).toBeVisible();

    const uploadResponse = page.waitForResponse(
      (r) => r.url().includes('/api/v1/admin/assets/upload') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    const fileChooserName = `au0-${Date.now()}.png`;
    await page
      .locator('[data-testid="assets-dropzone"] [data-testid="dropzone-input"]')
      .setInputFiles({ name: fileChooserName, mimeType: 'image/png', buffer: TINY_PNG });

    const queueRow = page.locator('[data-testid^="assets-upload-row-"]').first();
    await expect(queueRow).toBeVisible();
    const statusBadge = queueRow.locator('[data-testid^="assets-upload-status-"]').first();
    await expect(statusBadge).toBeVisible();

    const uploadResp = await uploadResponse;
    expect(uploadResp.status()).toBeLessThan(300);
    const body = (await uploadResp.json()) as { data: AssetLite } | AssetLite;
    const newAsset: AssetLite = 'data' in body ? (body as { data: AssetLite }).data : body;
    cleanupId = newAsset.id;

    await expect(statusBadge).toHaveText(/Ready/i, { timeout: 30_000 });
    await expect(page.locator(`[data-testid="asset-card-${newAsset.id}"]`)).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    if (cleanupId) {
      await deleteAsset(baseURL!, cleanupId);
    }
  }
});

test('AU0 — oversized file is rejected client-side without any POST', async ({ page }) => {
  await page.goto('/assets', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="assets-upload-block"]')).toBeVisible();

  let postFired = false;
  const listener = (req: { method: () => string; url: () => string }) => {
    if (req.method() === 'POST' && req.url().includes('/v1/admin/assets/upload')) {
      postFired = true;
    }
  };
  page.on('request', listener);

  const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 0); // 10 MB + 1 byte
  await page
    .locator('[data-testid="assets-dropzone"] [data-testid="dropzone-input"]')
    .setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: tooBig });

  const errorRow = page.locator('[data-testid^="assets-upload-error-"]').first();
  await expect(errorRow).toBeVisible();
  await expect(errorRow).toContainText(/10 MB/);
  await expect(page.locator('[data-testid^="assets-upload-status-"]').first()).toHaveText(
    /Failed/i,
  );

  // Wait briefly to confirm no POST was made (client gate intercepted).
  await page.waitForTimeout(750);
  expect(postFired).toBe(false);
  page.off('request', listener);
});

test('AU0 — magic-byte rejection surfaces a FAILED row with a retry CTA', async ({ page }) => {
  await page.goto('/assets', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="assets-upload-block"]')).toBeVisible();

  // Buffer with valid MIME extension/type but invalid PNG magic bytes — passes
  // the client-side MIME check, fails the server-side magic-byte gate (400).
  const fakePng = Buffer.from('not a real png at all just text bytes');

  const uploadResponse = page.waitForResponse(
    (r) => r.url().includes('/api/v1/admin/assets/upload') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );

  await page
    .locator('[data-testid="assets-dropzone"] [data-testid="dropzone-input"]')
    .setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: fakePng });

  const resp = await uploadResponse;
  expect(resp.status()).toBe(400);

  const queueRow = page.locator('[data-testid^="assets-upload-row-"]').first();
  await expect(queueRow).toBeVisible();
  await expect(queueRow.locator('[data-testid^="assets-upload-status-"]')).toHaveText(/Failed/i);
  await expect(queueRow.locator('[data-testid^="assets-upload-retry-"]')).toBeVisible();
});

test('DR-07 — referenced asset hides the destructive CTA + exposes View references', async ({
  page,
  baseURL,
}) => {
  const asset = await uploadAsset(baseURL!);
  const cleanupAssetId: string | null = asset.id;
  let originalProductAssets: ProductAssetRef[] = [];

  try {
    await pollAssetReady(baseURL!, asset.id);

    originalProductAssets = await fetchProductAssets(baseURL!, STABLE_PRODUCT_ID);
    const nextSort =
      originalProductAssets.length === 0
        ? 0
        : Math.max(...originalProductAssets.map((e) => e.sortOrder)) + 1;
    const next: ProductAssetRef[] = [
      ...originalProductAssets,
      { assetId: asset.id, sortOrder: nextSort, isPrimary: false },
    ];
    await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, next);

    const afterWire = await fetchAsset(baseURL!, asset.id);
    expect(afterWire.usage.total).toBeGreaterThan(0);

    await page.goto(`/assets/${asset.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="asset-detail-page"]')).toBeVisible();

    // Destructive CTA is hidden (DR-07 hard-delete blocked by service guard).
    await expect(page.locator('[data-testid="asset-delete"]')).toHaveCount(0);
    // "View references" CTA replaces it.
    await expect(page.locator('[data-testid="asset-view-references"]')).toBeVisible();

    let deleteRequestFired = false;
    const listener = (req: { method: () => string; url: () => string }) => {
      if (req.method() === 'DELETE' && req.url().includes(`/assets/${asset.id}`)) {
        deleteRequestFired = true;
      }
    };
    page.on('request', listener);

    // Footer summary flips to the references-aware copy.
    await expect(page.locator('#asset-delete-summary')).toContainText(/References/i);

    // No DELETE round-trips while the destructive CTA is hidden — the UI
    // path is not reachable. Defensive backend behaviour (DELETE → 409
    // ASSET_REFERENCED) is exercised in `assets-references.journey.spec.ts`.
    expect(deleteRequestFired).toBe(false);

    page.off('request', listener);
  } finally {
    if (cleanupAssetId) {
      // Restore the product's original asset list first (removes our test asset
      // from the join table) so the FK Restrict constraint doesn't block the
      // hard-delete below. Always call PATCH even when originalProductAssets is []
      // — the test added a reference that must be cleared before the asset delete.
      await replaceProductAssets(baseURL!, STABLE_PRODUCT_ID, originalProductAssets);
      await deleteAsset(baseURL!, cleanupAssetId);
    }
  }
});
