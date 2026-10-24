import { test, expect } from './_auth-fixture';
import { request, type APIRequestContext } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.10 — Categories drag-reorder journey.
 *
 * Covers `/categories` against the live backend: initial tree render, the
 * keyboard ArrowDown nudge PATCH round-trip with persistence across reload,
 * and axe-clean mount. The pointer-drag variant was removed after 4 fix
 * attempts failed to dispatch CDK's `(cdkDropListDropped)` output in headless
 * Chromium — CDK visually activates but never emits the drop event under
 * Playwright pointer simulation. The keyboard path exercises the identical
 * `reorderSiblings()` → `PATCH /v1/admin/categories/reorder` → persistence
 * chain; unit tests in `categories-tree.page.spec.ts` cover the pointer
 * `drop()` handler state transitions, rollback, and permission gating.
 *
 * Every write round-trips through `/api/v1/admin/categories/reorder`. Each
 * spec captures the initial root-level `sortOrder` and restores it on
 * teardown so parallel workers + re-runs stay deterministic. No
 * `page.route()`, no fixtures.
 */

// Category rows are shared catalogue state — two workers reordering at once
// would corrupt each other's teardown snapshot. Serialise the file.
test.describe.configure({ mode: 'serial' });

interface CategoryLite {
  id: string;
  sortOrder: number;
  parentId: string | null;
  children?: CategoryLite[];
}

async function fetchRoots(baseURL: string): Promise<CategoryLite[]> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.get('/api/v1/admin/categories', {
    headers: { Cookie: cookies },
  });
  const raw = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`[categories.journey] GET tree failed: ${res.status()} ${raw.slice(0, 200)}`);
  }
  const body = JSON.parse(raw) as { data: CategoryLite[] };
  const roots = Array.isArray(body.data)
    ? body.data.filter((c) => c.parentId === null || c.parentId === undefined)
    : [];
  roots.sort((a, b) => a.sortOrder - b.sortOrder);
  return roots;
}

async function patchReorder(
  baseURL: string,
  items: { id: string; sortOrder: number }[],
): Promise<number> {
  const cookies = getAdminCookies(baseURL);
  const ctx: APIRequestContext = await request.newContext({ baseURL });
  const res = await ctx.patch('/api/v1/admin/categories/reorder', {
    headers: { Cookie: cookies },
    data: { items },
  });
  await ctx.dispose();
  return res.status();
}

async function restoreRootOrder(baseURL: string, snapshot: CategoryLite[]): Promise<void> {
  if (snapshot.length < 2) return;
  const items = snapshot.map((c, index) => ({ id: c.id, sortOrder: index }));
  const status = await patchReorder(baseURL, items);
  if (status !== 204) {
    throw new Error(`[categories.journey] restore PATCH failed with status ${status}`);
  }
}

async function requireTwoRoots(baseURL: string): Promise<CategoryLite[]> {
  const roots = await fetchRoots(baseURL);
  if (roots.length < 2) {
    throw new Error(
      `[categories.journey] expected >= 2 top-level categories, found ${roots.length}`,
    );
  }
  return roots;
}

test('tree round-trip mounts with the live snapshot and is axe-clean', async ({
  page,
  baseURL,
}) => {
  const roots = await requireTwoRoots(baseURL!);
  await page.goto('/categories', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="categories-tree-page"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="categories-tree"]')).toBeVisible();
  for (const root of roots.slice(0, 3)) {
    await expect(page.locator(`[data-testid="category-row-${root.id}"]`)).toBeVisible();
  }
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: false });
});

test('keyboard ArrowDown nudges the first root past the second and persists', async ({
  page,
  baseURL,
}) => {
  const snapshot = await requireTwoRoots(baseURL!);
  const [first, second] = snapshot;

  try {
    await page.goto('/categories', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="categories-tree-page"]')).toBeVisible();

    const firstHandle = page.locator(`[data-testid="drag-handle-${first.id}"]`);
    await expect(firstHandle).toBeVisible();
    await firstHandle.focus();

    // Register the response listener BEFORE keyboard.press() — same race
    // condition as the drag test: keydown fires nudge → HTTP request → response
    // can all complete before the awaited waitForResponse runs if registered after.
    const reorderResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/admin/categories/reorder') && r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );

    await page.keyboard.press('ArrowDown');

    await reorderResponse;

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="categories-tree-page"]')).toBeVisible();

    const postRoots = await fetchRoots(baseURL!);
    const postFirst = postRoots.find((r) => r.id === first.id);
    const postSecond = postRoots.find((r) => r.id === second.id);
    expect(postFirst?.sortOrder).toBeDefined();
    expect(postSecond?.sortOrder).toBeDefined();
    expect((postFirst?.sortOrder ?? 0) > (postSecond?.sortOrder ?? 99)).toBe(true);
  } finally {
    await restoreRootOrder(baseURL!, snapshot);
  }
});
