import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * S17 — asset-picker primitive journey (DR-06).
 *
 * The picker has no consumer until S18 (product) and S19 (category +
 * section). This spec drives the dedicated `/dev/asset-picker` host route
 * end-to-end against the live backend at the configured viewport (the
 * `authed-desktop` project covers desktop; smoke + visual-regression
 * specs already enforce the public-route mobile viewport).
 *
 * No `page.route()`, no MSW, no fixtures. Asset upload + cleanup happen
 * via the real `/api/v1/admin/assets/*` endpoints.
 */

test.describe.configure({ mode: 'serial' });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

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
    throw new Error(`[asset-picker.journey] upload failed: ${res.status()} ${raw.slice(0, 200)}`);
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
  const ok = [204, 400, 404, 409].includes(res.status());
  if (!ok) throw new Error(`[asset-picker.journey] DELETE /assets/${id} failed: ${res.status()}`);
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
    throw new Error(`[asset-picker.journey] asset ${id} did not settle in ${timeoutMs} ms`);
  } finally {
    await ctx.dispose();
  }
}

test('host page renders + opens picker + axe-clean', async ({ page, baseURL }) => {
  // Seed at least one ready asset so the picker grid renders.
  const seeded = await uploadAsset(baseURL!, 's17-seed');
  await pollReady(baseURL!, seeded.id);

  try {
    await page.goto('/dev/asset-picker', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="dev-asset-picker-host"]')).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId('dev-open-single').click();
    const picker = page.locator('[data-testid="asset-picker"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await expect(picker.locator(`[data-testid="asset-picker-card-${seeded.id}"]`)).toBeVisible({
      timeout: 10_000,
    });

    await injectAxe(page);
    await checkA11y(page, '[data-testid="asset-picker"]', { detailedReport: false });

    // Esc-to-close — CDK provides this from `disableClose: false`.
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId('dev-result')).toContainText('cancel');
  } finally {
    await deleteAsset(baseURL!, seeded.id);
  }
});

test('single-select round trip — open → filter → pick → close', async ({ page, baseURL }) => {
  const seeded = await uploadAsset(baseURL!, 's17-single');
  await pollReady(baseURL!, seeded.id);

  try {
    await page.goto('/dev/asset-picker', { waitUntil: 'networkidle' });
    await page.getByTestId('dev-open-single').click();
    const picker = page.locator('[data-testid="asset-picker"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    // Filter to images and confirm the seeded asset survives.
    await picker.getByTestId('asset-picker-type-IMAGE').click();
    const card = picker.locator(`[data-testid="asset-picker-card-${seeded.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(picker).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId('dev-result')).toContainText(`select-single:${seeded.id}`);
  } finally {
    await deleteAsset(baseURL!, seeded.id);
  }
});

test('multi-select round trip — toggle two cards then confirm', async ({ page, baseURL }) => {
  const a = await uploadAsset(baseURL!, 's17-multi-a');
  const b = await uploadAsset(baseURL!, 's17-multi-b');
  await pollReady(baseURL!, a.id);
  await pollReady(baseURL!, b.id);

  try {
    await page.goto('/dev/asset-picker', { waitUntil: 'networkidle' });
    await page.getByTestId('dev-open-multi').click();
    const picker = page.locator('[data-testid="asset-picker"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    await picker.locator(`[data-testid="asset-picker-card-${a.id}"]`).click();
    await picker.locator(`[data-testid="asset-picker-card-${b.id}"]`).click();
    await expect(picker.getByTestId('asset-picker-confirm')).toContainText('Select 2');
    await picker.getByTestId('asset-picker-confirm').click();
    await expect(picker).toBeHidden({ timeout: 5_000 });

    // Use the retrying assertion to wait for the signal-based result to render
    // in the zoneless OnPush host page — direct textContent() could race the
    // microtask that updates the `result` signal after the dialog's `closed`
    // observable emits.
    const devResult = page.getByTestId('dev-result');
    await expect(devResult).toContainText('select-multi:', { timeout: 5_000 });
    const result = await devResult.textContent();
    expect(result).toContain(a.id);
    expect(result).toContain(b.id);
  } finally {
    await deleteAsset(baseURL!, a.id);
    await deleteAsset(baseURL!, b.id);
  }
});

// ── AU1 — Browse | Upload tablist (spec §4.B) ─────────────────────────────

test('AU1 — upload-from-picker single-mode auto-resolves on first READY', async ({
  page,
  baseURL,
}) => {
  // Authenticated as superadmin → carries `assets:create` → Upload tab visible.
  await page.goto('/dev/asset-picker', { waitUntil: 'networkidle' });
  await page.getByTestId('dev-open-single').click();
  const picker = page.locator('[data-testid="asset-picker"]');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await expect(picker.getByTestId('asset-picker-tab-upload')).toBeVisible();

  await picker.getByTestId('asset-picker-tab-upload').click();
  await expect(picker.getByTestId('asset-picker-upload-panel')).toBeVisible();

  const fileInput = picker.locator('[data-testid="asset-picker-dropzone"] input[type="file"]');
  await fileInput.setInputFiles({
    name: 'au1-single.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });

  // Single-mode auto-closes on first READY; result reflects the new asset id.
  await expect(picker).toBeHidden({ timeout: 30_000 });
  const printed = await page.getByTestId('dev-result').textContent();
  expect(printed).toContain('select-single:');

  const newId = printed!.replace('select-single:', '').trim();
  expect(newId.length).toBeGreaterThan(0);
  await deleteAsset(baseURL!, newId);
});

test('AU1 — upload-from-picker multi-mode appends + switches back to Browse + grid renders new tile', async ({
  page,
  baseURL,
}) => {
  const seed = await uploadAsset(baseURL!, 'au1-multi-seed');
  await pollReady(baseURL!, seed.id);

  let uploadedId: string | null = null;
  try {
    await page.goto('/dev/asset-picker', { waitUntil: 'networkidle' });
    await page.getByTestId('dev-open-multi').click();
    const picker = page.locator('[data-testid="asset-picker"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    await picker.locator(`[data-testid="asset-picker-card-${seed.id}"]`).click();
    await expect(picker.getByTestId('asset-picker-confirm')).toContainText('Select 1');

    await picker.getByTestId('asset-picker-tab-upload').click();
    await expect(picker.getByTestId('asset-picker-upload-panel')).toBeVisible();

    const fileInput = picker.locator('[data-testid="asset-picker-dropzone"] input[type="file"]');
    await fileInput.setInputFiles({
      name: 'au1-multi.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // Multi-mode: tab auto-switches back to Browse on first READY, selection
    // count rises, and the new tile appears in the refetched grid.
    await expect(picker.getByTestId('asset-picker-tab-browse')).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );
    await expect(picker.getByTestId('asset-picker-confirm')).toContainText('Select 2', {
      timeout: 10_000,
    });

    await picker.getByTestId('asset-picker-confirm').click();
    await expect(picker).toBeHidden({ timeout: 5_000 });

    // Use the retrying assertion to wait for the signal-based result to render.
    const devResult = page.getByTestId('dev-result');
    await expect(devResult).toContainText('select-multi:', { timeout: 5_000 });
    const printed = await devResult.textContent();
    expect(printed).toContain(seed.id);
    const ids = printed!.replace('select-multi:', '').split(',');
    uploadedId = ids.find((id) => id.trim() && id.trim() !== seed.id) ?? null;
    expect(uploadedId).not.toBeNull();
  } finally {
    await deleteAsset(baseURL!, seed.id);
    if (uploadedId) await deleteAsset(baseURL!, uploadedId);
  }
});

test('AU1 — Upload tab is rendered with the assets:create-bearing default fixture', async ({
  page,
}) => {
  // The authed-desktop fixture is `superadmin@merchants.test`, which carries
  // every permission including `assets:create`. We assert the positive RBAC
  // contract here: the tablist + Upload tab render. The negative branch
  // (Upload tab hidden when `assets:create` is absent) is exhaustively
  // covered by the unit spec at
  // `libs/admin-ui/src/organisms/asset-picker/asset-picker.component.spec.ts`
  // (Browse-only state, axe-clean). A mid-journey user-swap to drive the
  // negative branch in e2e would need a dedicated viewer seed + a custom
  // fixture, which is out of scope for AU1.
  await page.goto('/dev/asset-picker', { waitUntil: 'networkidle' });
  await page.getByTestId('dev-open-single').click();
  const picker = page.locator('[data-testid="asset-picker"]');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await expect(picker.getByTestId('asset-picker-tablist')).toBeVisible();
  await expect(picker.getByTestId('asset-picker-tab-browse')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(picker.getByTestId('asset-picker-tab-upload')).toHaveAttribute(
    'aria-selected',
    'false',
  );
});
