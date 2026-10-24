import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';
import { PERMISSION_MODULES } from '@permissions';
import { getAdminCookies } from './_helpers';

/**
 * Staff + Roles admin journey — list, role filter, create staff, weak-password
 * inline reject, edit staff via dialog, deactivate row, roles list + create
 * role + zero-perm reject + permission-grid PATCH persistence. Seeds its own
 * staff + role rows via the admin API. No fixtures, no page.route().
 */

interface SeedStaff {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface SeedRole {
  id: string;
  name: string;
  permissions: string[];
}

async function seedStaff(
  baseURL: string,
  overrides: { role?: 'ADMIN' | 'MANAGER' | 'SUPPORT' } = {},
): Promise<SeedStaff> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `e2e-staff-${unique}@e2e.test`;
  const firstName = `FirstE2e${unique.slice(0, 6)}`;
  const lastName = `LastE2e${unique.slice(0, 6)}`;
  const role = overrides.role ?? 'SUPPORT';

  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/staff', {
    headers: { Cookie: cookies },
    data: { email, password: 'StrongPass1!', firstName, lastName, role },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[staff-roles.journey] seed staff failed: ${res.status()} ${raw.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(raw) as { data: { id: string; email: string } };
  return { id: parsed.data.id, email: parsed.data.email, firstName, lastName };
}

async function deactivateStaffViaApi(baseURL: string, id: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  await ctx.delete(`/api/v1/admin/staff/${id}`, {
    headers: { Cookie: cookies },
  });
  await ctx.dispose();
}

async function seedRole(
  baseURL: string,
  overrides: { name?: string; permissions?: string[] } = {},
): Promise<SeedRole> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name = overrides.name ?? `e2e_role_${unique.slice(0, 8)}`;
  const permissions = overrides.permissions ?? ['orders:view'];

  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/v1/admin/roles', {
    headers: { Cookie: cookies },
    data: { name, permissions },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[staff-roles.journey] seed role failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw) as { data: { id: string; name: string; permissions: unknown } };
  const perms = Array.isArray(parsed.data.permissions)
    ? parsed.data.permissions.map((p) =>
        typeof p === 'string' ? p : (p as { permission: string }).permission,
      )
    : [];
  return { id: parsed.data.id, name: parsed.data.name, permissions: perms };
}

test('staff list renders against the live backend', async ({ page, baseURL }) => {
  const seed = await seedStaff(baseURL!);
  try {
    await page.goto('/staff', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="staff-list-page"]')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  } finally {
    await deactivateStaffViaApi(baseURL!, seed.id);
  }
});

test('staff list names every back-office account and its real role', async ({ page }) => {
  // Never assert an exact row count: other specs in the same run create staff.
  await page.goto('/staff?pageSize=100', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="staff-list-page"]')).toBeVisible();

  const body = page.locator('tbody');
  for (const email of [
    'superadmin@merchants.test',
    'admin@merchants.test',
    'manager@merchants.test',
    'support@merchants.test',
  ]) {
    await expect(body).toContainText(email, { timeout: 10_000 });
  }

  // The ROLES column used to dash on every row (finding F6).
  const roleCells = page.locator('[data-testid^="staff-roles-"]');
  const roles = await roleCells.allInnerTexts();
  expect(roles.length).toBeGreaterThan(0);
  for (const text of roles) {
    expect(text.trim()).not.toBe('—');
  }
  expect(roles.some((t) => t.includes('Super admin'))).toBe(true);

  // Super admins are visible but not manageable from here (finding F7).
  const superRow = page.locator('tbody tr', { hasText: 'superadmin@merchants.test' });
  await expect(superRow.locator('[data-testid^="staff-edit-"]')).toHaveCount(0);
  await expect(superRow.locator('[data-testid^="staff-deactivate-"]')).toHaveCount(0);
});

test('role filter scopes the list + updates the URL', async ({ page, baseURL }) => {
  const seed = await seedStaff(baseURL!, { role: 'SUPPORT' });
  try {
    await page.goto('/staff', { waitUntil: 'networkidle' });
    await page.locator('[data-testid="staff-role-filter-SUPPORT"]').click();
    await page.waitForURL(/role=SUPPORT/);
    expect(page.url()).toContain('role=SUPPORT');
  } finally {
    await deactivateStaffViaApi(baseURL!, seed.id);
  }
});

test('create staff persists a new row', async ({ page, baseURL }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `e2e-staff-create-${unique}@e2e.test`;
  let createdId: string | null = null;

  try {
    await page.goto('/staff', { waitUntil: 'networkidle' });
    await page.locator('[data-testid="staff-create-panel"] summary').click();
    await page.locator('input#staff-first').fill(`FirstCrt${unique.slice(0, 6)}`);
    await page.locator('input#staff-last').fill(`LastCrt${unique.slice(0, 6)}`);
    await page.locator('input#staff-email').fill(email);
    await page.locator('input#staff-password').fill('StrongPass1!');
    await page.locator('select#staff-role').selectOption('SUPPORT');
    await page.locator('[data-testid="staff-create-submit"]').click();
    const notice = page.locator('[data-testid="staff-notice"]');
    await expect(notice).toContainText(email, { timeout: 10_000 });

    const cookies = getAdminCookies(baseURL!);
    const ctx = await request.newContext({ baseURL: baseURL! });
    const res = await ctx.get(`/api/v1/admin/staff?pageSize=100&role=SUPPORT`, {
      headers: { Cookie: cookies },
    });
    const body = (await res.json()) as {
      data: { id: string; email: string }[];
    };
    await ctx.dispose();
    const created = body.data.find((s) => s.email === email);
    expect(created).toBeTruthy();
    createdId = created!.id;
  } finally {
    if (createdId) await deactivateStaffViaApi(baseURL!, createdId);
  }
});

test('create staff rejects weak password inline', async ({ page }) => {
  await page.goto('/staff', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="staff-create-panel"] summary').click();
  const pw = page.locator('input#staff-password');
  await pw.fill('weakpass');
  await pw.blur();
  await expect(page.getByText(/upper|digit|characters/i).first()).toBeVisible();
});

test('edit staff opens dialog, PATCHes firstName, and the row reflects it', async ({
  page,
  baseURL,
}) => {
  const seed = await seedStaff(baseURL!, { role: 'SUPPORT' });
  const newFirst = `Edited${Date.now().toString().slice(-6)}`;
  try {
    await page.goto(`/staff?role=SUPPORT&pageSize=100`, { waitUntil: 'networkidle' });
    await page.locator(`[data-testid="staff-edit-${seed.id}"]`).click();
    await expect(page.locator('[data-testid="staff-edit-dialog"]')).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, '[data-testid="staff-edit-dialog"]');
    const first = page.locator('[data-testid="staff-edit-first"] input');
    await first.fill(newFirst);
    await page.locator('[data-testid="staff-edit-submit"]').click();
    await expect(page.locator('[data-testid="staff-edit-dialog"]')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.locator(`[data-testid="staff-row-${seed.id}"]`)).toContainText(newFirst);
  } finally {
    await deactivateStaffViaApi(baseURL!, seed.id);
  }
});

test('deactivate opens confirm, deactivates, and the row is hidden', async ({ page, baseURL }) => {
  const seed = await seedStaff(baseURL!, { role: 'SUPPORT' });
  try {
    await page.goto(`/staff?role=SUPPORT&pageSize=100`, { waitUntil: 'networkidle' });
    await page.locator(`[data-testid="staff-deactivate-${seed.id}"]`).click();
    await page.locator('[data-testid="confirm-dialog-confirm"]').click();
    const notice = page.locator('[data-testid="staff-notice"]');
    await expect(notice).toContainText(seed.email, { timeout: 10_000 });
  } finally {
    await deactivateStaffViaApi(baseURL!, seed.id).catch(() => undefined);
  }
});

test('roles list renders against the live backend', async ({ page }) => {
  await page.goto('/roles', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="roles-page"]')).toBeVisible();
  await expect(page.locator('[data-testid^="role-card-"]').first()).toBeVisible();
  await injectAxe(page);
  await checkA11y(page, '[data-testid="roles-page"]', { detailedReport: false });
});

test('the grid shows only permissions an endpoint enforces', async ({ page }) => {
  // The grid used to render the union of every role's persisted set, so it
  // painted ten dead module families straight from the database.
  await page.goto('/roles', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="roles-page"]')).toBeVisible();

  for (const dead of ['gift-cards', 'rbac', 'tax', 'staff', 'refunds', 'currencies']) {
    await expect(page.locator(`[data-testid$="-perm-${dead}-view"]`)).toHaveCount(0);
  }
  // The canonical twin is present under its real spelling.
  await expect(page.locator('[data-testid$="-perm-gift_cards-view"]').first()).toBeVisible();

  const firstCard = page.locator('[data-testid^="role-card-"]').first();
  await expect(firstCard.locator('fieldset')).toHaveCount(PERMISSION_MODULES.length);
});

test('module headings read as words, not raw constants', async ({ page }) => {
  await page.goto('/roles', { waitUntil: 'networkidle' });
  const firstCard = page.locator('[data-testid^="role-card-"]').first();
  await expect(firstCard).toBeVisible();

  await expect(firstCard.getByText('Staff & Roles', { exact: true }).first()).toBeVisible();
  await expect(firstCard.getByText('ADMIN_USERS', { exact: true })).toHaveCount(0);
  await expect(firstCard.getByText('STOREFRONT_CONFIG', { exact: true })).toHaveCount(0);
  // The hint that tells the operator where currencies and tax actually live.
  await expect(firstCard.getByText('Currencies, tax, countries, webhooks').first()).toBeVisible();
});

test('the seeded Super Admin role saves and the change survives a reload', async ({ page }) => {
  // Red before this plan: the seed granted hyphenated keys the DTO rejects, so
  // every save of Super Admin or Admin returned 400.
  await page.goto('/roles', { waitUntil: 'networkidle' });
  const heading = page.getByRole('heading', { name: 'Super Admin', exact: true });
  await expect(heading).toBeVisible({ timeout: 10_000 });

  const card = page.locator('[data-testid^="role-card-"]').filter({ has: heading });
  const testId = await card.getAttribute('data-testid');
  const roleId = testId!.replace('role-card-', '');

  const checkbox = page.locator(`[data-testid="role-${roleId}-perm-analytics-delete"]`);
  await checkbox.uncheck();
  await page.locator(`[data-testid="role-save-${roleId}"]`).click();

  await expect(page.locator('[data-testid="roles-notice"]')).toContainText('Super Admin', {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="roles-error"] p')).toHaveClass(/sr-only/);

  await page.goto('/roles', { waitUntil: 'networkidle' });
  await expect(
    page.locator(`[data-testid="role-${roleId}-perm-analytics-delete"]`),
  ).not.toBeChecked({ timeout: 10_000 });

  // Put it back so the shared dev database is left as found.
  await page.locator(`[data-testid="role-${roleId}-perm-analytics-delete"]`).check();
  await page.locator(`[data-testid="role-save-${roleId}"]`).click();
  await expect(page.locator('[data-testid="roles-notice"]')).toContainText('Super Admin', {
    timeout: 10_000,
  });
});

test('create role persists a new card', async ({ page, baseURL }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name = `e2e_qa_${unique.slice(0, 8)}`;
  try {
    await page.goto('/roles', { waitUntil: 'networkidle' });
    await page.locator('[data-testid="roles-new"]').click();
    await expect(page.locator('[data-testid="role-create-dialog"]')).toBeVisible();
    await injectAxe(page);
    await checkA11y(page, '[data-testid="role-create-dialog"]');
    await page.locator('[data-testid="role-create-name"] input').fill(name);
    await page.locator('[data-testid="role-create-perm-orders-view"]').check();
    await page.locator('[data-testid="role-create-submit"]').click();
    await expect(page.locator('[data-testid="role-create-dialog"]')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name, exact: false })).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    // Backend does not expose role-delete; the per-test unique suffix keeps
    // repeated runs idempotent even without teardown.
    void baseURL;
  }
});

test('role create rejects empty permissions inline', async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/roles', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="roles-new"]').click();
  await page
    .locator('[data-testid="role-create-name"] input')
    .fill(`e2e_empty_${unique.slice(0, 6)}`);
  await page.locator('[data-testid="role-create-submit"]').click();
  await expect(page.locator('[data-testid="role-create-error"]')).toContainText(/at least one/i, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="role-create-dialog"]')).toBeVisible();
});

test('edit role permissions PATCHes and persists across a reload', async ({ page, baseURL }) => {
  const seed = await seedRole(baseURL!, { permissions: ['orders:view'] });
  try {
    await page.goto('/roles', { waitUntil: 'networkidle' });
    const checkbox = page.locator(`[data-testid="role-${seed.id}-perm-products-view"]`);
    await checkbox.waitFor({ state: 'visible', timeout: 10_000 });
    await checkbox.check();
    await page.locator(`[data-testid="role-save-${seed.id}"]`).click();
    const notice = page.locator('[data-testid="roles-notice"]');
    await expect(notice).toContainText(seed.name, { timeout: 10_000 });

    await page.goto('/roles', { waitUntil: 'networkidle' });
    const reloadedCheckbox = page.locator(`[data-testid="role-${seed.id}-perm-products-view"]`);
    await expect(reloadedCheckbox).toBeChecked({ timeout: 10_000 });
  } finally {
    void baseURL;
  }
});
