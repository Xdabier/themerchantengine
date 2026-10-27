import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.14 — Product restore journey.
 *
 * Two scenarios against the live backend:
 *   1. Active product detail page shows no restore affordance, axe-clean.
 *   2. Soft-deleted product renders a Restore button → confirm → PATCH
 *      /restore → the UI reflects DRAFT status, the button disappears,
 *      and the live-region announcement surfaces.
 *
 * No `page.route()`, no fixtures, no MSW. Each spec seeds its own
 * disposable product via POST, soft-deletes it in teardown (idempotent
 * — soft-deleting an already-soft-deleted row is a no-op on the
 * backend).
 */

test.describe.configure({ mode: 'serial' });

function uniqueSlug(): string {
  return `e2e-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedProduct(baseURL: string): Promise<{ id: string; slug: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const slug = uniqueSlug();
  const res = await ctx.post('/api/v1/admin/products', {
    headers: { Cookie: cookies },
    data: {
      name: {
        default: `Restore E2E ${slug}`,
        en: `Restore E2E ${slug}`,
        fr: `Restore E2E ${slug}`,
      },
      slug,
      status: 'DRAFT',
      description: {
        default:
          'Durable E2E restore-journey fixture with enough description text to satisfy the quality scorer threshold across all locales.',
        en: 'Durable E2E restore-journey fixture with enough description text to satisfy the quality scorer threshold across all locales.',
        fr: 'Fixture E2E de restauration, avec un texte de description assez long pour franchir le seuil de qualite du moteur dans toutes les langues.',
      },
      shortDescription: {
        default: 'E2E restore fixture short copy.',
        en: 'E2E restore fixture short copy.',
        fr: 'Texte court de la fixture E2E de restauration.',
      },
      metaTitle: {
        default: `Restore E2E ${slug}`,
        en: `Restore E2E ${slug}`,
        fr: `Restore E2E ${slug}`,
      },
      metaDescription: {
        default: 'E2E restore journey fixture meta description.',
        en: 'E2E restore journey fixture meta description.',
        fr: 'Meta description du parcours de restauration produit.',
      },
      variants: [{ sku: `SKU-${slug}`, price: 100, isDefault: true, isActive: true }],
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[products-restore.journey] seed product failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: { id: string; slug: string } };
  return { id: data.id, slug: data.slug };
}

async function softDeleteProduct(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.delete(`/api/v1/admin/products/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
  if (res.status() !== 204 && res.status() !== 404) {
    throw new Error(`[products-restore.journey] DELETE /products/${id} failed: ${res.status()}`);
  }
}

async function getProduct(
  baseURL: string,
  id: string,
): Promise<{ status: string; deletedAt: string | null }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/products/${id}`, {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[products-restore.journey] GET /products/${id} failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const { data } = JSON.parse(raw) as { data: { status: string; deletedAt: string | null } };
  return { status: data.status, deletedAt: data.deletedAt };
}

test('active product detail page shows no restore affordance (axe-clean)', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-restore-button"]')).toHaveCount(0);

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

test('soft-deleted product detail page exposes Restore → confirm → status flips to DRAFT', async ({
  page,
  baseURL,
}) => {
  const seeded = await seedProduct(baseURL!);
  try {
    await softDeleteProduct(baseURL!, seeded.id);

    await page.goto(`/products/${seeded.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible();

    const restoreBtn = page.locator('[data-testid="product-restore-button"]');
    await expect(restoreBtn).toBeVisible();

    await restoreBtn.click();
    await expect(page.locator('[data-testid="confirm-dialog-confirm"]')).toBeVisible();
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    await expect(page.locator('[data-testid="product-restore-button"]')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="product-restore-status"]')).toContainText(
      /restored/i,
      { timeout: 10_000 },
    );

    const afterRestore = await getProduct(baseURL!, seeded.id);
    expect(afterRestore.status).toBe('DRAFT');
    expect(afterRestore.deletedAt).toBeNull();
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});
