import { test, expect } from './_auth-fixture';
import { CANONICAL_MONEY_EXACT, STORE_CURRENCY, assertNoUsdLeak, firstIdFromApi } from './_helpers';

/**
 * Currency-rendering regression guard
 * (specs/features/admin-qa-remediation/plan-a-currency.md).
 *
 * The store runs on the active fixture's currency. Before this fix the admin showed the operator
 * `US$100.00` on products, bare unlabelled numbers like `6,539.2` on analytics,
 * and three competing money formats across screens, because no admin code read
 * the configured store currency.
 *
 * This asserts the canonical format is what actually renders against the live
 * backend: the ISO code before the amount, the store currency's own fraction
 * digits, one format everywhere. No fixtures, no `page.route()`
 * (constitution §3.8).
 *
 * Money output is deliberately locale-independent, so this does not need the
 * locale matrix; `locale-persistence.journey.spec.ts` covers switching.
 *
 * The admin format is NOT the storefront format. `EUR 1,234.50` here,
 * `1 234,500 DT` there; see `apps/admin/src/app/shared/format/money.ts` for
 * why the two surfaces diverge on purpose.
 */

test('products list prices carry the store currency', async ({ page }) => {
  await page.goto('/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible({ timeout: 10_000 });

  await assertNoUsdLeak(page, { expectAmount: true });
});

test('product detail variants and the edit pricing tab agree', async ({ page, baseURL }) => {
  // The title promised a comparison and the body ran a negative-only guard on
  // two routes, so two screens could have disagreed and this stayed green. It
  // now reads the same product's default price off both surfaces and asserts
  // they match, which is the contract the name claims.
  //
  // The edit page's price sits behind `tab() === 'pricing'`, reachable by
  // `?tab=pricing`; navigating to `/edit` alone lands on the general tab, where
  // no amount renders at all.
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/products?pageSize=1');

  await page.goto(`/products/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await assertNoUsdLeak(page, { expectAmount: true });

  await page.goto(`/products/${id}/edit?tab=pricing`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible({ timeout: 10_000 });
  await assertNoUsdLeak(page, { expectAmount: true });

  const sku = (await page.locator('[data-testid="edit-default-sku"]').innerText()).trim();
  const editPrice = (await page.locator('[data-testid="edit-default-price"]').innerText()).trim();

  // Matched by SKU rather than by row position: the detail table iterates every
  // variant and nothing guarantees the default is first.
  await page.goto(`/products/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible({
    timeout: 10_000,
  });
  const detailPrice = (
    await page
      .locator('[data-testid="variant-row"]')
      .filter({ has: page.locator('[data-testid="variant-row-sku"]', { hasText: sku }) })
      .locator('[data-testid="variant-row-price"]')
      .innerText()
  ).trim();

  expect(detailPrice).toBe(editPrice);
});

test('every analytics revenue tile is labelled money, never a bare number', async ({ page }) => {
  await page.goto('/analytics/revenue', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="analytics-revenue-page"]')).toBeVisible({
    timeout: 10_000,
  });

  const tiles = page.locator('dd');
  const count = await tiles.count();
  expect(count).toBeGreaterThan(0);

  let moneyTiles = 0;
  for (let i = 0; i < count; i++) {
    const text = (await tiles.nth(i).innerText()).trim();
    // Counts and percentages live in the same list; only money must carry a code.
    if (text.includes(STORE_CURRENCY)) {
      expect(text).toMatch(CANONICAL_MONEY_EXACT);
      moneyTiles++;
    }
  }
  expect(moneyTiles).toBeGreaterThan(0);
  await assertNoUsdLeak(page, { expectAmount: true });
});

test('dashboard revenue KPIs carry the currency and drop the hedging caption', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('body')).not.toContainText('Gross, all currencies');
  await assertNoUsdLeak(page, { expectAmount: true });
});

test('a BOGO promotion is described by quantities, not formatted as money', async ({ page }) => {
  await page.goto('/promotions', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="promotions-list-page"]')).toBeVisible({
    timeout: 10_000,
  });

  const body = await page.locator('body').innerText();
  // Whatever promotion types the seed carries, none of them may render dollars.
  await assertNoUsdLeak(page);
  // A BOGO row, if present, reads as quantities.
  if (body.includes('Buy X get Y')) {
    expect(body).toMatch(/Buy \d+, get \d+ free|—/);
  }
});

test('gift-card issue offers a currency select preset to the store currency', async ({ page }) => {
  await page.goto('/gift-cards/issue', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-issue-page"]')).toBeVisible({
    timeout: 10_000,
  });

  const select = page.locator('[data-testid="gc-currency-select"]');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue(STORE_CURRENCY);
  await assertNoUsdLeak(page);
});

test('settings general shows the currency read-only and points at the real editor', async ({
  page,
}) => {
  await page.goto('/settings/general', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="settings-general-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.locator('body')).not.toContainText('Default currency');
  await expect(page.locator('#gen-currency')).toHaveCount(0);

  const row = page.locator('[data-testid="settings-store-currency"]');
  await expect(row).toContainText(STORE_CURRENCY);
  await expect(page.locator('[data-testid="settings-currency-link"]')).toHaveAttribute(
    'href',
    '/currencies',
  );
  await assertNoUsdLeak(page);
});

test('order totals keep rendering in the currency recorded on the order', async ({
  page,
  baseURL,
}) => {
  await page.goto('/orders', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="orders-list-page"]')).toBeVisible({ timeout: 10_000 });
  await assertNoUsdLeak(page, { expectAmount: true });

  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/orders?pageSize=1');
  await page.goto(`/orders/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="order-detail-page"]')).toBeVisible({ timeout: 10_000 });
  await assertNoUsdLeak(page, { expectAmount: true });
});

test('money inputs name their unit', async ({ page }) => {
  await page.goto('/gift-cards/issue', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-issue-page"]')).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.locator('[data-testid="input-suffix"]').first()).toHaveText(STORE_CURRENCY);
  await expect(page.locator('body')).toContainText(`Amount in ${STORE_CURRENCY}.`);
});
