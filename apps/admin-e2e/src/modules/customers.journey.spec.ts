import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { assertNoObjectObjectLeak, assertNotRawId, getAdminCookies } from './_helpers';

/**
 * Customers admin journey — list, search, segment filter, detail edit + save,
 * deactivate + reactivate, 409 duplicate email, 404 on bogus id, and the
 * dedicated segments view. Seeds its own customer rows via the public
 * registration endpoint (no admin-side customer POST exists) and tears them
 * down via admin PATCH with isActive=false. No fixtures, no page.route().
 */

async function seedCustomer(
  baseURL: string,
  overrides: { firstName?: string; lastName?: string; email?: string } = {},
): Promise<{ id: string; email: string; firstName: string; lastName: string }> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = overrides.email ?? `e2e-customer-${unique}@e2e.test`;
  const firstName = overrides.firstName ?? `FirstE2e${unique.slice(0, 6)}`;
  const lastName = overrides.lastName ?? `LastE2e${unique.slice(0, 6)}`;

  const ctx = await request.newContext({ baseURL });
  // Better Auth sign-up endpoint (DR-24, BA3) — replaces the retired /auth/register.
  // The name field is required by Better Auth core; derive it from firstName + lastName
  // (matching the databaseHook in apps/api/src/auth/auth.ts).
  const res = await ctx.post('/api/v1/auth/sign-up/email', {
    data: {
      email,
      password: 'Passw0rd!Seed',
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
    },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[customers.journey] seed customer failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  // Better Auth returns { user: { id, ... } } directly (not wrapped in { data }).
  const body = JSON.parse(raw) as { user: { id: string; email: string } };
  return { id: body.user.id, email: body.user.email, firstName, lastName };
}

/** Id of a seeded customer, looked up by email through the admin directory. */
async function seededCustomerId(baseURL: string, email: string): Promise<string> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get(`/api/v1/admin/customers?search=${encodeURIComponent(email)}`, {
    headers: { Cookie: cookies },
  });
  const body = (await res.json()) as { data: Array<{ id: string; email: string }> };
  await ctx.dispose();
  const hit = body.data?.find((c) => c.email === email);
  if (!hit) throw new Error(`[customers.journey] seeded customer ${email} not found`);
  return hit.id;
}

async function deactivateCustomerViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.patch(`/api/v1/admin/customers/${id}`, {
    headers: { Cookie: cookies },
    data: { isActive: false },
  });
  await ctx.dispose();
}

test('customers list renders against the live backend', async ({ page, baseURL }) => {
  const seed = await seedCustomer(baseURL!);
  try {
    await page.goto('/customers', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="customers-list-page"]')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  } finally {
    await deactivateCustomerViaApi(baseURL!, seed.id);
  }
});

test('search scopes the list to the seeded customer', async ({ page, baseURL }) => {
  const seed = await seedCustomer(baseURL!);
  try {
    await page.goto('/customers', { waitUntil: 'networkidle' });
    const searchInput = page.locator('[data-testid="customers-search"]');
    await searchInput.fill(seed.email);
    // Angular Router writes '@' literally in query strings (RFC 3986 §3.4 permits it);
    // encodeURIComponent would produce '%40' which never matches the actual URL.
    const escapedEmail = seed.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.waitForURL(new RegExp(`search=${escapedEmail}`), {
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="customer-row-${seed.id}"]`)).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await deactivateCustomerViaApi(baseURL!, seed.id);
  }
});

test('segment chip filter updates URL + shows only matching rows', async ({ page }) => {
  await page.goto('/customers', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="segment-filter-ACTIVE"]').click();
  await page.waitForURL(/segment=ACTIVE/);
  expect(page.url()).toContain('segment=ACTIVE');
});

test('segment chip filter narrows the rows, not only the URL', async ({ page }) => {
  await page.goto('/customers', { waitUntil: 'networkidle' });
  const rows = page.locator('[data-testid^="customer-row-"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });

  // CHURNED means "has orders, none in the last 365 days". Every seeded order
  // is minted at seed time, so the cohort is empty on any working database —
  // a filter that does nothing would leave the rows on screen.
  const churnedRequest = page.waitForRequest(
    (req) => req.url().includes('/admin/customers') && req.url().includes('segment=CHURNED'),
  );
  await page.locator('[data-testid="segment-filter-CHURNED"]').click();
  await churnedRequest;
  await expect(rows).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('No customers match the current filter.')).toBeVisible();

  await page.locator('[data-testid="segment-filter-all"]').click();
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
});

test('the seeded customer shows her real order count, lifetime value, and segment', async ({
  page,
}) => {
  const email = 'customer2@test.com';
  await page.goto(`/customers?search=${email}`, { waitUntil: 'networkidle' });

  const row = page.locator('[data-testid^="customer-row-"]').first();
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Sara Hassan owns ORD-2026-000003 and ORD-2026-000004 in the seed. The cell used
  // to read 0 because the UI bound a key the API never sent (finding F3).
  await expect(row.locator('td').nth(2)).toHaveText('2');
  await expect(row.locator('td').nth(3)).not.toHaveText('—');
  await expect(row.locator('app-badge')).toHaveCount(1);

  // The dead column is gone everywhere (finding F4).
  await expect(page.locator('body')).not.toContainText('Last login');
});

test('customer detail renders the edit form seeded from the record', async ({ page, baseURL }) => {
  const seed = await seedCustomer(baseURL!);
  try {
    await page.goto(`/customers/${seed.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="customer-detail-page"]')).toBeVisible();
    await expect(page.locator('input#cust-first')).toHaveValue(seed.firstName);
    await expect(page.locator('input#cust-email')).toHaveValue(seed.email);
  } finally {
    await deactivateCustomerViaApi(baseURL!, seed.id);
  }
});

test('edit firstName persists via PATCH and reloads with the new value', async ({
  page,
  baseURL,
}) => {
  const seed = await seedCustomer(baseURL!);
  const newFirst = `Renamed${Date.now().toString().slice(-6)}`;
  try {
    await page.goto(`/customers/${seed.id}`, { waitUntil: 'networkidle' });
    const firstInput = page.locator('input#cust-first');
    await firstInput.fill(newFirst);
    const patched = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.endsWith(`/v1/admin/customers/${seed.id}`) &&
        res.request().method() === 'PATCH',
    );
    await page.locator('[data-testid="customer-save"]').click();
    expect((await patched).status()).toBe(200);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.goto(`/customers/${seed.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('input#cust-first')).toHaveValue(newFirst);
  } finally {
    await deactivateCustomerViaApi(baseURL!, seed.id);
  }
});

test('duplicate-email edit surfaces the 409 error banner', async ({ page, baseURL }) => {
  const seedA = await seedCustomer(baseURL!);
  const seedB = await seedCustomer(baseURL!);
  try {
    await page.goto(`/customers/${seedB.id}`, { waitUntil: 'networkidle' });
    const emailInput = page.locator('input#cust-email');
    await emailInput.fill(seedA.email);
    await page.locator('[data-testid="customer-save"]').click();
    const banner = page.locator('[data-testid="customer-detail-error"]');
    await expect(banner).toContainText(/already in use/i, { timeout: 10_000 });
  } finally {
    await deactivateCustomerViaApi(baseURL!, seedA.id);
    await deactivateCustomerViaApi(baseURL!, seedB.id);
  }
});

test('deactivate opens confirm, flips status, and Reactivate re-enables', async ({
  page,
  baseURL,
}) => {
  const seed = await seedCustomer(baseURL!);
  try {
    await page.goto(`/customers/${seed.id}`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="customer-deactivate"]').click();
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();

    await expect(page.locator('[data-testid="customer-reactivate"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="customer-deactivate"]')).toHaveCount(0);

    await page.locator('[data-testid="customer-reactivate"]').click();
    await expect(page.locator('[data-testid="customer-deactivate"]')).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await deactivateCustomerViaApi(baseURL!, seed.id);
  }
});

test('customer detail reaches her own orders, addresses, and reviews', async ({
  page,
  baseURL,
}) => {
  const saraId = await seededCustomerId(baseURL!, 'customer2@test.com');
  await page.goto(`/customers/${saraId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="customer-detail-page"]')).toBeVisible();

  // Sections exist and each resolved, not silently blank.
  await expect(page.locator('[data-testid="customer-orders-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="customer-addresses-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="customer-reviews-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="customer-orders-degraded"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="customer-reviews-degraded"]')).toHaveCount(0);

  // Her order was unreachable from her record before finding F5 was fixed.
  const orderLink = page.getByRole('link', { name: 'ORD-2026-000004' });
  await expect(orderLink).toBeVisible({ timeout: 10_000 });

  await assertNoObjectObjectLeak(page);
  await assertNotRawId(
    page.locator('[data-testid="customer-orders-section"] tbody tr').first().locator('td').first(),
    'customer order number',
  );

  await orderLink.click();
  await expect(page.locator('[data-testid="order-detail-page"]')).toBeVisible({ timeout: 10_000 });
});

test('bogus customer id surfaces the not-found error banner', async ({ page }) => {
  await page.goto('/customers/00000000-0000-0000-0000-000000000000', {
    waitUntil: 'networkidle',
  });
  const banner = page.locator('[data-testid="customer-detail-error"]');
  await expect(banner).toContainText(/not found/i, { timeout: 10_000 });
});

test('segments view renders every card and links into the filtered list', async ({ page }) => {
  await page.goto('/customers/segments', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="customer-segments-page"]')).toBeVisible();

  const cardSelectors = [
    'segment-card-LOYAL',
    'segment-card-ACTIVE',
    'segment-card-NEW',
    'segment-card-AT_RISK',
    'segment-card-CHURNED',
  ];
  for (const id of cardSelectors) {
    await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
  }

  // Finding F4: VIP and HIGH_VALUE have no criteria anywhere in the backend, so
  // their cards could only ever show a permanent zero.
  await expect(page.locator('[data-testid="segment-card-VIP"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="segment-card-HIGH_VALUE"]')).toHaveCount(0);

  // Finding E18: every card used to be titled the constant word "Segment".
  await expect(page.locator('[data-testid="segment-heading-LOYAL"]')).toHaveText('Loyal');
  await expect(page.locator('[data-testid="segment-heading-AT_RISK"]')).not.toHaveText('Segment');

  await page.locator('[data-testid="segment-link-ACTIVE"]').click();
  await page.waitForURL(/\/customers\?.*segment=ACTIVE/);
  await expect(page.locator('[data-testid="customers-list-page"]')).toBeVisible();
});
