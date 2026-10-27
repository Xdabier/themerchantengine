import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.16 — Global admin search journey.
 *
 * Two scenarios against the live backend:
 *   1. /search?q=<token> fans out across product + customer + cms groups.
 *   2. /search?q=<token>&type=product narrows to the product group only.
 *
 * Every run seeds a fresh product whose slug carries a unique token,
 * then tears it down with a soft-delete on `finally`. No fixtures, no
 * page.route(), no MSW.
 */

test.describe.configure({ mode: 'serial' });

function uniqueToken(): string {
  return `gse2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedProduct(
  baseURL: string,
  token: string,
  suffix = 'slug',
): Promise<{ id: string; slug: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const slug = `${token}-${suffix}`;
  const res = await ctx.post('/api/v1/admin/products', {
    headers: { Cookie: cookies },
    data: {
      name: {
        default: `GlobalSearch E2E ${token}`,
        en: `GlobalSearch E2E ${token}`,
        fr: `Recherche globale E2E ${token}`,
      },
      slug,
      status: 'DRAFT',
      description: {
        default:
          'Durable E2E global-search fixture with enough description text to satisfy the quality scorer threshold across all locales.',
        en: 'Durable E2E global-search fixture with enough description text to satisfy the quality scorer threshold across all locales.',
        fr: 'Fixture E2E de recherche globale, avec un texte de description assez long pour franchir le seuil de qualite du moteur dans toutes les langues.',
      },
      shortDescription: {
        default: 'E2E global-search fixture short copy.',
        en: 'E2E global-search fixture short copy.',
        fr: 'Texte court de la fixture E2E de recherche globale.',
      },
      metaTitle: {
        default: `GlobalSearch E2E ${token}`,
        en: `GlobalSearch E2E ${token}`,
        fr: `Recherche globale E2E ${token}`,
      },
      metaDescription: {
        default: 'E2E global-search journey fixture meta description.',
        en: 'E2E global-search journey fixture meta description.',
        fr: 'Meta description du parcours E2E de recherche globale.',
      },
      variants: [
        {
          sku: `SKU-${token.toUpperCase()}-${suffix.toUpperCase()}`,
          price: 100,
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
      `[global-search.journey] seed product failed: ${res.status()} ${raw.slice(0, 200)}`,
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
    throw new Error(`[global-search.journey] DELETE /products/${id} failed: ${res.status()}`);
  }
}

test('global search surfaces cross-entity results for a seeded product (axe-clean)', async ({
  page,
  baseURL,
}) => {
  const token = uniqueToken();
  const seeded = await seedProduct(baseURL!, token);
  try {
    await page.goto(`/search?q=${token}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="search-results-page"]')).toBeVisible({
      timeout: 10_000,
    });

    const productGroup = page.locator('[data-testid="search-group-product"]');
    await expect(productGroup).toBeVisible({ timeout: 10_000 });
    await expect(productGroup.getByRole('link', { name: new RegExp(token, 'i') })).toBeVisible();

    await expect(page.locator('[data-testid="search-empty"]')).toHaveCount(0);

    const visibleGroups = await page.locator('[data-testid^="search-group-"]').count();
    expect(visibleGroups).toBeGreaterThanOrEqual(3);

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

test('type filter narrows global search to the product group only', async ({ page, baseURL }) => {
  const token = uniqueToken();
  const seeded = await seedProduct(baseURL!, token);
  try {
    await page.goto(`/search?q=${token}&type=product`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="search-results-page"]')).toBeVisible({
      timeout: 10_000,
    });

    await expect(page.locator('[data-testid="search-group-product"]')).toBeVisible();
    await expect(page.locator('[data-testid="search-group-order"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="search-group-customer"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="search-group-cms"]')).toHaveCount(0);

    const productType = page.locator('[data-testid="search-type-product"]');
    await expect(productType).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await softDeleteProduct(baseURL!, seeded.id);
  }
});

/**
 * QA D4 — the results page rendered 20 rows under an "82" badge with nothing
 * saying 62 hits were invisible. Seeds past the per-group limit of 20 so the
 * truncation branch is exercised for real, then follows the deep link into the
 * products list (which grew its own search box in phase D3).
 */
test('a truncated group says so and deep-links into the module list', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const token = uniqueToken();
  const COUNT = 21; // one past the endpoint's per-group limit
  const seeded: Array<{ id: string }> = [];
  try {
    for (let i = 0; i < COUNT; i += 1) {
      seeded.push(await seedProduct(baseURL!, token, `p${i}`));
    }

    await page.goto(`/search?q=${token}&type=product`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="search-results-page"]')).toBeVisible({
      timeout: 15_000,
    });

    const notice = page.locator('[data-testid="search-group-truncation-product"]');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText(/Showing 20 of \d+/);

    await notice.getByRole('link', { name: /View all in Products/i }).click();
    await page.waitForURL(
      (url) => url.pathname === '/products' && url.searchParams.get('search') === token,
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible({
      timeout: 15_000,
    });
    // Wait for the filtered fetch to settle: the page mounts with skeletons.
    await expect(page.locator('tr[data-testid^="product-row-"]').first()).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    for (const p of seeded) await softDeleteProduct(baseURL!, p.id);
  }
});
