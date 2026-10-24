import { expect, request, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeStoreConfigFixture } from '@common/store-config-fixtures';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUID_RE = /^c[a-z0-9]{20,}$/i;

/**
 * Entity-rendering guard. Fails if any visible text on the page contains the
 * literal `[object Object]` — the signature of a `Translatable`/object value
 * bound into a template without being reduced to a display string. Call this
 * after a route has hydrated (and again after a mutation/reload) on any screen
 * that renders entity names. Cheap; scan the whole rendered `<body>`.
 */
export async function assertNoObjectObjectLeak(page: Page): Promise<void> {
  const body = await page.locator('body').innerText();
  expect(
    body.includes('[object Object]'),
    'rendered page leaked an unreduced object ("[object Object]") — a Translatable was bound without the | translatable pipe / pickTranslation',
  ).toBe(false);
}

/**
 * Entity-rendering guard. Fails if the given locator's trimmed text is a bare
 * UUID or cuid — the signature of a database id rendered where a human-readable
 * name belongs. Point it at an identity cell/heading (e.g. an order's Customer,
 * a merchandising rule's Product, a variant-detail H1).
 */
export async function assertNotRawId(locator: Locator, label = 'identity field'): Promise<void> {
  const text = (await locator.innerText()).trim();
  expect(
    UUID_RE.test(text) || CUID_RE.test(text),
    `${label} should show a readable name, not a raw database id ("${text}")`,
  ).toBe(false);
}

/**
 * The scenario fixture the target under test was seeded from (plan E0.4,
 * `demo` unless STORE_CONFIG_FIXTURE names another). Every money assertion
 * derives its currency code and precision from it, never from a literal.
 */
export const STORE_CONFIG = activeStoreConfigFixture();
export const STORE_CURRENCY = STORE_CONFIG.money.currencyCode;
export const STORE_PRECISION = STORE_CONFIG.money.displayPrecision;

/**
 * `EUR 1,234.50` under demo: code, space, grouped amount, exactly the store's
 * display precision. A render at any other precision is a defect signature
 * rather than the contract. Lives here rather than in the journey spec so the
 * negative guard and the positive assertion cannot drift apart.
 */
export const CANONICAL_MONEY = new RegExp(
  `${STORE_CURRENCY} \\d[\\d,]*\\.\\d{${STORE_PRECISION}}(?!\\d)`,
);
export const CANONICAL_MONEY_EXACT = new RegExp(
  `^${STORE_CURRENCY} \\d[\\d,]*\\.\\d{${STORE_PRECISION}}$`,
);
/** The precision a half-finished money change is most likely to leave behind. */
const WRONG_PRECISION = STORE_PRECISION === 3 ? 2 : 3;

/**
 * Currency guard on every money screen.
 *
 * This used to be a pure negative that enumerated exactly one wrong answer,
 * `US$100.00` or `$100`, and it had two holes that mattered at D4. It could
 * not see a leftover previous-currency string, or a store amount at the wrong precision,
 * which is the precise signature of a half-finished money rebrand. And because
 * `body.innerText` is `''` on a route that failed to render, an empty page
 * matched nothing and the guard reported green — the failure mode that makes a
 * guard worse than none.
 *
 * Its doc then claimed it also asserted a positive, "the page must carry at
 * least one canonical amount", and it never did: the only positive was a
 * non-empty body, which any rendered route satisfies. That gap is what
 * `expectAmount` closes. It is opt-in because several money SCREENS legitimately
 * render no formatted amount — a gift-card issue form has a currency select and
 * an input suffix, a settings row names the code without an amount — so a
 * blanket assertion would fail them for being correct.
 *
 * Call it after a route has hydrated, on any screen that renders money, and
 * pass `expectAmount: true` wherever an amount must actually appear.
 */
export async function assertNoUsdLeak(
  page: Page,
  options: { expectAmount?: boolean } = {},
): Promise<void> {
  // Asserted first, and through the retrying locator matcher rather than a
  // one-shot innerText read, so it also settles the page before the negative
  // scan below reads it.
  if (options.expectAmount) {
    await expect(
      page.locator('body'),
      `page rendered no canonical ${STORE_CURRENCY} amount — a money surface either failed to load or formatted outside the contract`,
    ).toContainText(CANONICAL_MONEY);
  }

  const body = await page.locator('body').innerText();

  expect(
    body.trim().length,
    'page rendered no text at all — the guard cannot pass on a blank page',
  ).toBeGreaterThan(0);

  const leaks: Array<[RegExp, string]> = [
    [/US\$|\$\d/, 'a dollar amount'],
    // A store-currency amount at the wrong number of fraction digits: the
    // money moved but the precision did not.
    [
      new RegExp(`\\b${STORE_CURRENCY} \\d[\\d,]*\\.\\d{${WRONG_PRECISION}}(?!\\d)`),
      `a ${STORE_CURRENCY} amount at ${WRONG_PRECISION} decimals`,
    ],
  ];

  for (const [re, what] of leaks) {
    const match = body.match(re);
    expect(
      match === null,
      `rendered page leaked ${what} ("${match?.[0]}") — a money surface is not reading CurrencyStore`,
    ).toBe(true);
  }
}

/**
 * Navigate to a path and assert the page's top-level `data-testid` mounted.
 * Also drops a full-page screenshot into `.e2e-review/` so I can eyeball
 * each route after a run. The directory is gitignored — artefacts are
 * local-only and regenerated on every run.
 */
export async function expectRoute(page: Page, path: string, testid: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 10_000 });
  // Filename slug from the route path: /foo/bar/:id → foo-bar-id
  const slug =
    path
      .replace(/^\//, '')
      .replace(/[/?&=]/g, '-')
      .replace(/[^a-z0-9-]/gi, '_') || 'root';
  await page.screenshot({ path: `.e2e-review/${slug}.png`, fullPage: true });
}

const STORAGE_STATE_PATH = resolve(
  __dirname,
  '..',
  '..',
  '.playwright-state',
  'storage-state.json',
);

interface StorageCookie {
  name: string;
  value: string;
}

/**
 * Return the Better Auth session cookies captured by global-setup as a
 * `Cookie:` header string. Callers pass this to admin API requests in place
 * of the retired `Authorization: Bearer` header (DR-24, BA3).
 *
 * Reads from `.playwright-state/storage-state.json` — global-setup writes
 * this file once before the suite starts. Better Auth sessions are
 * server-side and replayable, so all workers can share the same token
 * without re-authenticating (which would trigger Better Auth's per-IP/email
 * rate limiter on the test API).
 *
 * The `baseURL` parameter is accepted for API compatibility with callers but
 * is no longer used for a live sign-in call.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAdminCookies(_baseURL: string): string {
  if (!existsSync(STORAGE_STATE_PATH)) {
    throw new Error(
      `[getAdminCookies] storage-state.json not found at ${STORAGE_STATE_PATH}. ` +
        'Run the suite once so global-setup can capture it.',
    );
  }
  const raw = readFileSync(STORAGE_STATE_PATH, 'utf8');
  const state = JSON.parse(raw) as { cookies: StorageCookie[] };
  const sessionCookies = state.cookies.filter((c) => c.name.startsWith('better-auth'));
  if (!sessionCookies.length) {
    throw new Error(
      '[getAdminCookies] storage-state.json has no better-auth cookies. ' +
        'Delete the file and re-run global-setup to capture a fresh session.',
    );
  }
  return sessionCookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Pull the first entity id from a list endpoint on the live backend. Uses
 * Better Auth cookie-based auth (DR-24, BA3) — the retired `Authorization:
 * Bearer` pattern no longer works.
 */
export async function firstIdFromApi(baseURL: string, listPath: string): Promise<string> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get(listPath, {
    headers: { Cookie: cookies },
  });
  const rawBody = await res.text();
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[firstIdFromApi] GET ${listPath} -> ${res.status()}: ${rawBody.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(rawBody) as { data: Array<{ id: string }> };
  if (!body.data || body.data.length === 0) {
    throw new Error(`[firstIdFromApi] ${listPath} returned empty data[]`);
  }
  return body.data[0].id;
}

/**
 * Commit an `app-entity-select` option by name, after the search for `term`
 * has actually come back.
 *
 * The picker primes page 1 on mount, and `fetch()` never clears the options it
 * already holds (`apps/admin/src/app/shared/entity-select/entity-select.component.ts`
 * lines 317-337). Its status line is computed from those same options, so it
 * keeps reading `Showing N of M` right through the 200 ms debounce and the
 * request that follows. `statusText` only says `Searching…` once `loading`
 * flips, and `loading` does not flip until the debounce fires (lines 189-207).
 *
 * So neither `Showing N of M` nor `[data-entity-option]` having rows proves
 * this term's results are on screen: both are satisfied by the pre-search list.
 * A spec that asserted on the status and then clicked `.first()` was really
 * clicking whatever product sorted first in the unfiltered catalogue, which on
 * a shared test database is whatever a sibling spec seeded most recently
 * (products list defaults to `createdAt desc`).
 *
 * The two real signals are the response carrying this term and the row that
 * carries `optionText`. `optionText` must identify exactly one row, because naming
 * the row is the whole point, so an ambiguous match is a failure, not a
 * coin toss.
 *
 * One caveat for callers: the picker pipes typing through
 * `distinctUntilChanged()`, so searching the same term twice on the same
 * mounted picker fires no second request and the wait below would time out.
 * Reload (or use a different term) between two searches of one instance.
 */
export async function pickEntityOption(
  page: Page,
  pickerTestId: string,
  term: string,
  optionText: string | RegExp,
): Promise<void> {
  const picker = page.locator(`[data-testid="${pickerTestId}"]`);
  await expect(picker).toBeVisible({ timeout: 15_000 });
  // The option list renders in the CDK overlay container at the end of
  // `<body>`, not beside the input, so scope through the listbox the input
  // names in `aria-controls`: a page can carry more than one picker.
  const listboxId = await picker.getAttribute('aria-controls');
  if (!listboxId) {
    throw new Error(`picker "${pickerTestId}" names no listbox in aria-controls`);
  }
  const field = page.locator(`#${listboxId}`);

  const searched = page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      res.url().includes(`search=${encodeURIComponent(term)}`) &&
      res.ok(),
    { timeout: 20_000 },
  );
  await picker.click();
  await picker.fill(term);
  await searched;

  const option = field.locator('[data-entity-option]').filter({ hasText: optionText });
  await expect(
    option,
    `picker "${pickerTestId}" searched "${term}" and rendered no single row matching ${String(
      optionText,
    )}: either the search did not filter or the term is ambiguous`,
  ).toHaveCount(1, { timeout: 15_000 });
  await option.click();
  // commit() closes the popup, so an empty list is proof the click landed on
  // the row we named rather than somewhere harmless beside it.
  await expect(field.locator('[data-entity-option]')).toHaveCount(0, { timeout: 5_000 });
}

interface AdminVariantRow {
  id: string;
  sku: string;
}

interface AdminStockLevelRow {
  locationId: string;
  onHand: number;
}

/**
 * Guarantee a named SKU can serve `minOnHand` units from a single location,
 * and hand back the ids the journey needs.
 *
 * Order journeys spend real stock: every manual order and every edit-page line
 * addition decrements the seeded variant permanently, and the seed only grants
 * `SHOE-URB-42` eight units (`prisma/seed.ts:1362`). A spec that merely assumed
 * stock was there stayed green until a sibling spec, a retry, or a re-run
 * drained it, then failed on `Insufficient stock for variant "<id>"`, a
 * message that names an id and nothing an operator or an agent could trace back
 * to test isolation. Topping up through the live adjust endpoint removes that
 * coupling without mocking anything.
 *
 * `minOnHand` is measured per location, not summed: `decrementStock` picks the
 * single location with the highest `onHand` and its guarded UPDATE requires
 * that one location to cover the whole line
 * (`apps/api/src/modules/inventory/inventory.service.ts:202-228`).
 */
export async function ensureVariantStock(
  baseURL: string,
  sku: string,
  minOnHand: number,
): Promise<{ productId: string; variantId: string }> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  try {
    const listRes = await ctx.get(
      `/api/v1/admin/products?pageSize=20&search=${encodeURIComponent(sku)}`,
      { headers: { Cookie: cookies } },
    );
    if (!listRes.ok()) {
      throw new Error(
        `[ensureVariantStock] product search for ${sku} -> ${listRes.status()}: ${(
          await listRes.text()
        ).slice(0, 200)}`,
      );
    }
    const list = (await listRes.json()) as {
      data: Array<{ id: string; variants?: AdminVariantRow[] }>;
    };
    let productId = '';
    let variantId = '';
    for (const product of list.data) {
      const variant = (product.variants ?? []).find((v) => v.sku === sku);
      if (variant) {
        productId = product.id;
        variantId = variant.id;
        break;
      }
    }
    if (!variantId) {
      throw new Error(
        `[ensureVariantStock] no variant with SKU ${sku} in the test database. The seed changed`,
      );
    }

    const stockRes = await ctx.get(`/api/v1/admin/inventory/variant/${variantId}`, {
      headers: { Cookie: cookies },
    });
    if (!stockRes.ok()) {
      throw new Error(
        `[ensureVariantStock] GET inventory/variant/${variantId} -> ${stockRes.status()}`,
      );
    }
    // `GET /v1/admin/inventory/variant/:id` returns `{ data: { variant, levels } }`
    // (InventoryService.getVariantStockDetail), not a bare array under `data`.
    const levels =
      ((await stockRes.json()) as { data: { levels: AdminStockLevelRow[] } }).data?.levels ?? [];
    const best = [...levels].sort((a, b) => b.onHand - a.onHand)[0];
    if (best && best.onHand >= minOnHand) return { productId, variantId };

    let locationId = best?.locationId;
    if (!locationId) {
      const locRes = await ctx.get('/api/v1/admin/inventory/locations?pageSize=1', {
        headers: { Cookie: cookies },
      });
      if (!locRes.ok()) {
        throw new Error(`[ensureVariantStock] GET inventory/locations -> ${locRes.status()}`);
      }
      const locations = ((await locRes.json()) as { data: Array<{ id: string }> }).data ?? [];
      if (!locations.length) {
        throw new Error('[ensureVariantStock] no inventory location exists to hold the top-up');
      }
      locationId = locations[0].id;
    }

    const adjustRes = await ctx.patch('/api/v1/admin/inventory/adjust', {
      headers: { Cookie: cookies, 'X-Idempotency-Key': randomUUID() },
      data: {
        variantId,
        locationId,
        quantity: minOnHand - (best?.onHand ?? 0),
        reason: 'RECOUNT',
        notes: `e2e top-up so the orders journey can spend ${sku}`,
      },
    });
    if (!adjustRes.ok()) {
      throw new Error(
        `[ensureVariantStock] PATCH inventory/adjust -> ${adjustRes.status()}: ${(
          await adjustRes.text()
        ).slice(0, 200)}`,
      );
    }
    return { productId, variantId };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Read a `<select>`'s options and return the value of the one whose visible
 * text starts with `label`. Variant selects render `SKU (price)`, so the SKU is
 * the stable half; picking by index instead means the journey silently spends
 * whichever variant the API happened to order first.
 */
export async function optionValueByLabelPrefix(select: Locator, label: string): Promise<string> {
  const options = await select
    .locator('option')
    .evaluateAll((nodes) =>
      (nodes as HTMLOptionElement[]).map((o) => ({ value: o.value, text: o.textContent ?? '' })),
    );
  const match = options.find((o) => o.value && o.text.trim().startsWith(label));
  expect(
    match,
    `no option starting with "${label}". Options were: ${options
      .map((o) => o.text.trim())
      .join(' | ')}`,
  ).toBeTruthy();
  return match!.value;
}
