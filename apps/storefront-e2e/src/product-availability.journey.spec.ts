import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Phase D6.1, availability is visible with its state colour on BOTH surfaces.
 *
 * brand-floor §8.2: "Availability is always visible on the product card and
 * product page, with its state colour, never hidden behind a click."
 *
 * Three states, the same literals `STOCK_STATUSES` carries in
 * `apps/api/src/modules/inventory/inventory.constants.ts`, and the §2.3 state
 * colour each one owns:
 *
 *   IN_STOCK     → --brand-success  Vert livré
 *   LOW_STOCK    → --brand-warning  Ambre attente
 *   OUT_OF_STOCK → --brand-error    Rouge rupture
 *
 * Real API, real seed, no `page.route()` and no fixtures per constitution
 * §3.8. The expected state of every card comes from `GET /v1/products`, which
 * grades each variant through `InventoryService.availabilityForVariants`, so
 * this journey asserts the whole chain: StockLevel row → API payload →
 * SSR card → product page. A card that hardcodes one state, or an API that
 * stops emitting the field, fails here rather than in a brand audit later.
 *
 * The state of a rendered badge is read from its localized LABEL rather than
 * from a machine attribute. The three labels are distinct in both locales, so
 * the mapping is unambiguous, and it keeps this spec from inventing a DOM
 * contract on top of the two test ids brand-floor §8.2 already implies.
 *
 * Colour is asserted against the resolved custom properties rather than a
 * literal rgb triple, so a palette revision in `brand.css` moves this spec
 * with it. Both the charte hex and its derived text step count as the state
 * colour: `brand.css` cuts `--brand-success-text` / `--brand-warning-text`
 * precisely because the charte greens and ambers clear 3:1 but not the 4.5:1
 * WCAG 1.4.3 floor for text, so a text badge that took the raw hex would ship
 * a contrast failure. What is never allowed is a FOREIGN state colour: a green
 * "Rupture" is the defect this rule exists to catch.
 */

type AvailabilityState = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

const AVAILABILITY_STATES: readonly AvailabilityState[] = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'];

/**
 * `product.stock.*` in `apps/storefront/src/i18n/{fr,en}.ts`. Duplicated here
 * rather than imported: `apps/storefront-e2e` compiles standalone (commonjs,
 * `types: ["node"]`) and no spec in this suite reaches into the storefront
 * source tree. A drift between the two shows up as a failure naming the exact
 * string the page rendered.
 */
const STATE_LABELS: Partial<Record<StorefrontLocale, Record<AvailabilityState, string>>> = {
  fr: { IN_STOCK: 'En stock', LOW_STOCK: 'Stock faible', OUT_OF_STOCK: 'Rupture' },
  en: { IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock' },
  ar: { IN_STOCK: 'متوفر', LOW_STOCK: 'الكمية محدودة', OUT_OF_STOCK: 'نفد المخزون' },
};

/**
 * `product.delivery.estimate` in `apps/storefront/src/i18n/{fr,en}.ts`,
 * duplicated here for the same reason `STATE_LABELS` is: this suite compiles
 * standalone and never reaches into the storefront source tree.
 */
const DELIVERY_PROMISE: Partial<Record<StorefrontLocale, string>> = {
  fr: 'Délai de livraison affiché au paiement',
  en: 'Delivery time shown at checkout',
  ar: 'يظهر وقت التوصيل عند إتمام الطلب',
};

const CARD_DELIVERY = '.delivery';
const PAGE_DELIVERY = '[data-testid="product-summary"] .delivery';

/** brand-floor §2.3 plus the derived text steps `brand.css` cuts from them. */
const STATE_TOKENS: Record<AvailabilityState, readonly string[]> = {
  IN_STOCK: ['--brand-success', '--brand-success-text'],
  LOW_STOCK: ['--brand-warning', '--brand-warning-text'],
  OUT_OF_STOCK: ['--brand-error', '--brand-error-hover'],
};

const ALL_STATE_TOKENS: readonly string[] = [
  ...new Set(AVAILABILITY_STATES.flatMap((state) => [...STATE_TOKENS[state]])),
];

const CATALOG_GRID = '[data-testid="catalog-grid"]';
const CARD_AVAILABILITY = '[data-testid="product-card-availability"]';
const PAGE_AVAILABILITY = '[data-testid="product-availability"]';
const PRODUCT_SUMMARY = '[data-testid="product-summary"]';

/** `PAGE_SIZE` in `apps/storefront/src/app/pages/[locale]/catalog/index.page.ts`. */
const CATALOG_PAGE_SIZE = 24;
/** Safety stop so a future large seed cannot turn discovery into a crawl. */
const MAX_CATALOGUE_PAGES = 6;
/** Catalogue pages the N1 delivery sweep walks before giving up on a state. */
const CARD_SWEEP_PAGES = 3;
/** Vite SSR cold-start budget, matching the other multi-step journeys here. */
const FIRST_PAINT = 30_000;

// ── API discovery ─────────────────────────────────────────────────────────────

interface CatalogueEntry {
  slug: string;
  /** Distinct availabilities across the product's active variants. */
  states: AvailabilityState[];
  variantCount: number;
  /** 1-based catalogue page this product lands on at `CATALOG_PAGE_SIZE`. */
  cataloguePage: number;
}

function isAvailabilityState(value: unknown): value is AvailabilityState {
  return (
    typeof value === 'string' &&
    (AVAILABILITY_STATES as readonly string[]).includes(value as string)
  );
}

/**
 * Walks `GET /v1/products` at the storefront's own page size so page N of this
 * map is page N of the rendered catalogue: the storefront sends no `sortBy`,
 * so both halves take the same API default ordering.
 */
async function fetchCatalogueStates(
  request: APIRequestContext,
  locale: StorefrontLocale,
): Promise<Map<string, CatalogueEntry>> {
  const entries = new Map<string, CatalogueEntry>();
  let page = 1;
  let totalPages = 1;

  do {
    const res = await request.get(
      `${STOREFRONT_API_BASE}/v1/products?page=${page}&pageSize=${CATALOG_PAGE_SIZE}`,
      { headers: { 'Accept-Language': locale } },
    );
    expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
    const body = (await res.json()) as {
      data?: unknown;
      meta?: { totalPages?: unknown };
    };
    totalPages = Number(body.meta?.totalPages ?? 1);
    const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

    for (const row of rows) {
      const product = row as { slug?: unknown; variants?: unknown };
      if (typeof product.slug !== 'string') continue;
      const variants: unknown[] = Array.isArray(product.variants) ? product.variants : [];
      const states = [
        ...new Set(
          variants
            .map((variant) => (variant as { availability?: unknown }).availability)
            .filter(isAvailabilityState),
        ),
      ];
      entries.set(product.slug, {
        slug: product.slug,
        states,
        variantCount: variants.length,
        cataloguePage: page,
      });
    }
    page += 1;
  } while (page <= totalPages && page <= MAX_CATALOGUE_PAGES);

  return entries;
}

// ── DOM probe ─────────────────────────────────────────────────────────────────

interface AvailabilityProbe {
  /** Product href of the surrounding card, null on the product page itself. */
  href: string | null;
  present: boolean;
  laidOut: boolean;
  text: string;
  /** Every colour the badge and its descendants paint, computed. */
  colours: string[];
}

/**
 * Reads the availability badge inside each `containerSelector` match. Runs on a
 * freshly loaded page with no clicks in between, which is the "never hidden
 * behind a click" half of §8.2: anything that needed an interaction to appear
 * comes back `laidOut: false`.
 */
async function probeAvailability(
  page: Page,
  containerSelector: string,
  availabilitySelector: string,
): Promise<AvailabilityProbe[]> {
  return page.evaluate(
    ({ containerSelector: containers, availabilitySelector: badge }) => {
      const PROPS = [
        'color',
        'backgroundColor',
        'borderTopColor',
        'borderRightColor',
        'borderBottomColor',
        'borderLeftColor',
        'outlineColor',
        'textDecorationColor',
        'fill',
        'stroke',
      ];
      const read = (node: Element, pseudo?: string): string[] => {
        const bag = window.getComputedStyle(node, pseudo) as unknown as Record<string, string>;
        return PROPS.map((prop) => bag[prop]).filter(
          (value) => typeof value === 'string' && value.length > 0,
        );
      };
      const collect = (node: Element): string[] => {
        const out = [...read(node), ...read(node, '::before'), ...read(node, '::after')];
        for (const child of Array.from(node.querySelectorAll('*'))) {
          out.push(...read(child), ...read(child, '::before'), ...read(child, '::after'));
        }
        return out;
      };
      const laidOut = (node: Element): boolean => {
        let cursor: Element | null = node;
        while (cursor) {
          const style = window.getComputedStyle(cursor);
          if (style.display === 'none') return false;
          if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
          if (Number(style.opacity) === 0) return false;
          cursor = cursor.parentElement;
        }
        return node.getClientRects().length > 0;
      };

      return Array.from(document.querySelectorAll(containers)).map((container) => {
        const link = container.querySelector('a[href*="/catalog/product/"]');
        const element = container.matches(badge) ? container : container.querySelector(badge);
        return {
          href: link ? link.getAttribute('href') : null,
          present: element !== null,
          laidOut: element !== null && laidOut(element),
          text: element ? (element.textContent ?? '').replace(/\s+/g, ' ').trim() : '',
          colours: element ? collect(element) : [],
        };
      });
    },
    { containerSelector, availabilitySelector },
  );
}

/** Resolves the §2.3 tokens off the live document so a palette edit follows. */
async function resolveStatePalette(page: Page): Promise<Record<string, string>> {
  const raw = await page.evaluate(
    (tokens: string[]) => {
      const style = window.getComputedStyle(document.documentElement);
      const out: Record<string, string> = {};
      for (const token of tokens) out[token] = style.getPropertyValue(token).trim();
      return out;
    },
    [...ALL_STATE_TOKENS],
  );

  const unresolved = Object.entries(raw)
    .filter(([, value]) => value.length === 0)
    .map(([token]) => token);
  expect(
    unresolved,
    'brand.css must define every §2.3 state token these assertions resolve against',
  ).toEqual([]);
  return raw;
}

// ── Colour normalisation ──────────────────────────────────────────────────────

/**
 * `r,g,b` for anything comparable, null for a transparent or unparseable
 * value. `getComputedStyle` answers `rgb(...)` / `rgba(...)`; the tokens are
 * declared as hex in `brand.css`, so both shapes have to land on one key.
 */
function rgbKey(value: string): string | null {
  const input = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((char) => char + char)
            .join('')
        : hex[1];
    const packed = Number.parseInt(digits, 16);
    return `${(packed >> 16) & 255},${(packed >> 8) & 255},${packed & 255}`;
  }

  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(input);
  if (!rgb) return null;
  const alphaRaw = rgb[4];
  if (alphaRaw !== undefined) {
    const alpha = alphaRaw.endsWith('%')
      ? Number(alphaRaw.slice(0, -1)) / 100
      : Number.parseFloat(alphaRaw);
    if (!Number.isFinite(alpha) || alpha === 0) return null;
  }
  return `${Math.round(Number(rgb[1]))},${Math.round(Number(rgb[2]))},${Math.round(Number(rgb[3]))}`;
}

function tokenKeys(palette: Record<string, string>, tokens: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const token of tokens) {
    const key = rgbKey(palette[token] ?? '');
    if (key) keys.add(key);
  }
  return keys;
}

// ── Assertions ────────────────────────────────────────────────────────────────

/**
 * Containment rather than equality, so a badge that pairs its label with a
 * decorative dot or a visually-hidden prefix still resolves. The three labels
 * do not contain one another in either locale, so exactly one can match, and
 * anything ambiguous is reported rather than guessed.
 */
function stateFromLabel(locale: StorefrontLocale, text: string): AvailabilityState | null {
  const labels = copyFor(STATE_LABELS, locale);
  const haystack = text.toLocaleLowerCase(locale);
  const matches = AVAILABILITY_STATES.filter((state) =>
    haystack.includes(labels[state].toLocaleLowerCase(locale)),
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Asserts one badge: it is on screen, it reads as one of the three localized
 * labels, that label agrees with what the API says the product's variants
 * carry, it paints its own state colour, and it paints no other state's.
 * Returns the state it resolved so callers can accumulate coverage.
 */
function assertAvailabilityBadge(args: {
  probe: AvailabilityProbe;
  locale: StorefrontLocale;
  palette: Record<string, string>;
  where: string;
  expectedStates?: AvailabilityState[];
}): AvailabilityState {
  const { probe, locale, palette, where, expectedStates } = args;

  expect(
    probe.present,
    `${where}: brand-floor §8.2 requires an availability element, none matched`,
  ).toBe(true);
  expect(
    probe.laidOut,
    `${where}: availability must be visible on load, never behind a click (§8.2)`,
  ).toBe(true);

  const state = stateFromLabel(locale, probe.text);
  expect(
    state,
    `${where}: availability read "${probe.text}", expected one of ${AVAILABILITY_STATES.map(
      (candidate) => `"${copyFor(STATE_LABELS, locale)[candidate]}"`,
    ).join(' / ')}`,
  ).not.toBeNull();
  const resolved = state as AvailabilityState;

  if (expectedStates && expectedStates.length > 0) {
    expect(
      expectedStates,
      `${where}: rendered "${probe.text}" (${resolved}) but the API reports ${expectedStates.join(
        ' / ',
      )} for this product`,
    ).toContain(resolved);
  }

  const painted = new Set(
    probe.colours.map((colour) => rgbKey(colour)).filter((key): key is string => key !== null),
  );
  const own = tokenKeys(palette, STATE_TOKENS[resolved]);
  const foreign = AVAILABILITY_STATES.filter((candidate) => candidate !== resolved).flatMap(
    (candidate) => [...tokenKeys(palette, STATE_TOKENS[candidate])],
  );

  expect(
    [...own].some((key) => painted.has(key)),
    `${where}: "${probe.text}" (${resolved}) must paint its §2.3 state colour ` +
      `(${STATE_TOKENS[resolved].join(' or ')}), painted ${[...painted].join(' | ') || 'nothing'}`,
  ).toBe(true);

  const wrong = foreign.filter((key) => painted.has(key) && !own.has(key));
  expect(
    wrong,
    `${where}: "${probe.text}" (${resolved}) paints another state's colour, which §2.3 forbids`,
  ).toEqual([]);

  return resolved;
}

function slugOf(href: string | null): string | null {
  if (!href) return null;
  const match = /\/catalog\/product\/([^/?#]+)/.exec(href);
  return match ? match[1] : null;
}

/**
 * The seed bands this journey depends on. Named in the failure message so a
 * missing state reads as "the seed no longer plants it" rather than as a
 * mystery, and so nobody is tempted to close the gap with `test.skip`.
 */
const SEED_BAND_NOTE =
  'prisma/seeds/fixture-catalogue/products.ts plants stockBand `low` on FX-LAP-AIR13-LGT, ' +
  'FX-AUD-PRO-PRD, FX-WR-SPS and FX-HM-SHD, and `oos` on FX-WR-STS; ' +
  'prisma/seeds/fixture-catalogue/inventory.ts turns those into onHand 2 and onHand 0.';

describeEveryLocale('storefront D6.1 product availability', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`every catalogue card shows its availability with its state colour (${locale})`, async ({
    page,
    request,
  }) => {
    const catalogue = await fetchCatalogueStates(request, locale);
    expect(catalogue.size, 'the seeded catalogue must expose products').toBeGreaterThan(0);

    // The API half of "end to end": every active variant carries one of the
    // three literals. Without it no card can render a truthful state.
    const withoutAvailability = [...catalogue.values()]
      .filter((entry) => entry.variantCount > 0 && entry.states.length === 0)
      .map((entry) => entry.slug);
    expect(
      withoutAvailability,
      'GET /v1/products must fold stock into a three-state `availability` on every active variant',
    ).toEqual([]);

    await page.goto(`/${locale}/catalog`);
    await expect(page.locator(CATALOG_GRID).first()).toBeVisible({ timeout: FIRST_PAINT });
    await expect(
      page.locator(`${CATALOG_GRID} app-product-card ${CARD_AVAILABILITY}`).first(),
    ).toBeVisible({ timeout: FIRST_PAINT });

    const palette = await resolveStatePalette(page);
    const cards = await probeAvailability(
      page,
      `${CATALOG_GRID} app-product-card`,
      CARD_AVAILABILITY,
    );
    expect(cards.length, 'catalogue page 1 must render product cards').toBeGreaterThan(0);

    const seen = new Set<AvailabilityState>();
    for (const probe of cards) {
      const slug = slugOf(probe.href);
      seen.add(
        assertAvailabilityBadge({
          probe,
          locale,
          palette,
          where: `catalogue card ${slug ?? '(no product link)'}`,
          expectedStates: slug ? catalogue.get(slug)?.states : undefined,
        }),
      );
    }

    // Coverage: a card surface that renders only IN_STOCK proves nothing about
    // the other two colours. Any state page 1 does not hold is asserted on the
    // catalogue page the API says it lands on, never skipped.
    for (const state of AVAILABILITY_STATES) {
      if (seen.has(state)) continue;
      const holder = [...catalogue.values()].find(
        (entry) => entry.states.length === 1 && entry.states[0] === state,
      );
      expect(
        holder,
        `the seeded catalogue contains no product whose variants are all ${state}, so the card ` +
          `surface cannot prove that state's colour. ${SEED_BAND_NOTE}`,
      ).toBeDefined();

      await page.goto(`/${locale}/catalog?page=${holder!.cataloguePage}`);
      await expect(page.locator(CATALOG_GRID).first()).toBeVisible({ timeout: FIRST_PAINT });
      // Page 1 paints from the SSR seed immediately; pages 2..N restore via
      // `restoreFromPage2` (`catalog/index.page.ts:512-536`), an async
      // client-side append that runs after first paint. Waiting on the grid
      // alone races that append, the same seam
      // `catalog-infinite-scroll.journey.spec.ts` guards with its
      // `gridCardCount` poll on the identical `?page=N` deep-link. Waiting on
      // the target product's own card link absorbs that restore window
      // directly rather than guessing a card count.
      await expect(
        page
          .locator(`${CATALOG_GRID} app-product-card a[href*="/catalog/product/${holder!.slug}"]`)
          .first(),
      ).toBeVisible({ timeout: FIRST_PAINT });
      const laterCards = await probeAvailability(
        page,
        `${CATALOG_GRID} app-product-card`,
        CARD_AVAILABILITY,
      );
      const target = laterCards.find((probe) => slugOf(probe.href) === holder!.slug);
      expect(
        target,
        `catalogue page ${holder!.cataloguePage} must render a card for ${holder!.slug}`,
      ).toBeDefined();
      seen.add(
        assertAvailabilityBadge({
          probe: target!,
          locale,
          palette,
          where: `catalogue card ${holder!.slug}`,
          expectedStates: holder!.states,
        }),
      );
    }

    expect(
      AVAILABILITY_STATES.filter((state) => !seen.has(state)),
      `the card surface must render all three §2.3 states. ${SEED_BAND_NOTE}`,
    ).toEqual([]);
  });

  test(`the product page shows availability with its state colour, in every state (${locale})`, async ({
    page,
    request,
  }) => {
    const catalogue = await fetchCatalogueStates(request, locale);

    // One representative per state, restricted to products whose variants all
    // agree, so the assertion never depends on how a multi-variant product
    // rolls its variants up into one badge.
    const representatives = new Map<AvailabilityState, CatalogueEntry>();
    for (const state of AVAILABILITY_STATES) {
      const entry = [...catalogue.values()].find(
        (candidate) => candidate.states.length === 1 && candidate.states[0] === state,
      );
      if (entry) representatives.set(state, entry);
    }

    const missing = AVAILABILITY_STATES.filter((state) => !representatives.has(state));
    expect(
      missing,
      `the seeded catalogue must contain a product in each of the three states so this journey ` +
        `can prove each colour. Missing: ${missing.join(', ')}. ${SEED_BAND_NOTE}`,
    ).toEqual([]);

    let palette: Record<string, string> | null = null;
    let lastRoute = '';
    let lastState: AvailabilityState = 'IN_STOCK';

    for (const state of AVAILABILITY_STATES) {
      const entry = representatives.get(state)!;
      lastRoute = `/${locale}/catalog/product/${entry.slug}`;
      lastState = state;

      await page.goto(lastRoute);
      await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
      await expect(page.locator(PAGE_AVAILABILITY).first()).toBeVisible({ timeout: FIRST_PAINT });

      palette = palette ?? (await resolveStatePalette(page));
      const [probe] = await probeAvailability(page, PAGE_AVAILABILITY, PAGE_AVAILABILITY);
      expect(probe, `product page ${entry.slug} must expose ${PAGE_AVAILABILITY}`).toBeDefined();
      const rendered = assertAvailabilityBadge({
        probe,
        locale,
        palette,
        where: `product page ${entry.slug}`,
        expectedStates: entry.states,
      });
      expect(
        rendered,
        `product page ${entry.slug} must render ${state}, the state its variants carry`,
      ).toBe(state);
    }

    // The seam an SSR-then-hydrate surface loses things in: the badge is in the
    // first byte, then the client boots and re-renders it from a second payload.
    // Leaving and returning proves the state survives that, with no new console
    // error across the boundary.
    await reloadAndAssertClean(page, lastRoute, baseline, {
      afterReload: async () => {
        const element = page.locator(PAGE_AVAILABILITY).first();
        await expect(element).toBeVisible({ timeout: FIRST_PAINT });
        await expect(element).toContainText(copyFor(STATE_LABELS, locale)[lastState], {
          timeout: FIRST_PAINT,
        });
      },
    });
  });

  /**
   * Finding H5 + P3 (plan N, phase N1). The delivery promise used to print
   * unconditionally, so an out-of-stock product page showed "Out of stock"
   * and the delivery estimate one line apart, and every card carrying
   * that product did the same.
   *
   * Asserted on both surfaces and in both directions: absent when the product
   * is out of stock, present when it is in stock. Only the positive half can
   * catch a gate that hid the promise everywhere.
   */
  test(`the delivery promise follows availability on the page and the card (${locale})`, async ({
    page,
    request,
  }) => {
    const catalogue = await fetchCatalogueStates(request, locale);
    const single = (state: AvailabilityState): CatalogueEntry | undefined =>
      [...catalogue.values()].find(
        (candidate) => candidate.states.length === 1 && candidate.states[0] === state,
      );

    const outOfStock = single('OUT_OF_STOCK');
    const inStock = single('IN_STOCK');
    expect(
      { outOfStock: outOfStock?.slug ?? null, inStock: inStock?.slug ?? null },
      `this journey needs one all-out-of-stock and one all-in-stock product. ${SEED_BAND_NOTE}`,
    ).toEqual({ outOfStock: expect.any(String), inStock: expect.any(String) });

    const promise = copyFor(DELIVERY_PROMISE, locale);

    // Product page, in stock: the promise is there, so the negative half below
    // is proof of a gate rather than proof of a deleted line.
    const inStockRoute = `/${locale}/catalog/product/${inStock!.slug}`;
    await page.goto(inStockRoute);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator(PAGE_DELIVERY)).toHaveText(promise, { timeout: FIRST_PAINT });

    // Product page, out of stock: gone from the DOM entirely.
    const outRoute = `/${locale}/catalog/product/${outOfStock!.slug}`;
    await page.goto(outRoute);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator(PAGE_AVAILABILITY).first()).toContainText(
      copyFor(STATE_LABELS, locale).OUT_OF_STOCK,
      { timeout: FIRST_PAINT },
    );
    await expect(page.locator(PAGE_DELIVERY)).toHaveCount(0);

    // Catalogue cards. Read off the rendered grid rather than off an
    // API-computed page number: the shared test database accumulates products
    // from backend e2e runs, and a slug's position in the catalogue drifts with
    // that (the documented reason the card test above is a known baseline red).
    // Walking the grid asserts the invariant on EVERY card it finds, which is
    // strictly more than one representative would prove, and only needs the two
    // states to show up somewhere in the first few pages.
    const seenStates = new Set<string>();
    for (let catalogPage = 1; catalogPage <= CARD_SWEEP_PAGES; catalogPage += 1) {
      await page.goto(`/${locale}/catalog?page=${catalogPage}`);
      await expect(page.locator(CATALOG_GRID).first()).toBeVisible({ timeout: FIRST_PAINT });
      await expect(
        page.locator(`${CATALOG_GRID} app-product-card ${CARD_AVAILABILITY}`).first(),
      ).toBeVisible({ timeout: FIRST_PAINT });

      const cards = await page.evaluate(
        ({ gridSelector, badge, deliverySelector }) =>
          Array.from(document.querySelectorAll(`${gridSelector} app-product-card`)).map((card) => {
            const delivery = card.querySelector(deliverySelector);
            return {
              href: card.querySelector('a[href*="/catalog/product/"]')?.getAttribute('href') ?? '',
              state: (card.querySelector(badge)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
              slotPresent: delivery !== null,
              text: (delivery?.textContent ?? '').replace(/\s+/g, ' ').trim(),
              hidden: delivery?.getAttribute('aria-hidden') ?? null,
            };
          }),
        {
          gridSelector: CATALOG_GRID,
          badge: CARD_AVAILABILITY,
          deliverySelector: CARD_DELIVERY,
        },
      );
      expect(cards.length, `catalogue page ${catalogPage} must render cards`).toBeGreaterThan(0);

      for (const card of cards) {
        // The slot itself always survives: it is what keeps every card in a
        // grid row at the same outer height.
        expect(card.slotPresent, `card ${card.href} must keep the delivery slot`).toBe(true);
        if (card.state === copyFor(STATE_LABELS, locale).OUT_OF_STOCK) {
          expect(card.text, `out-of-stock card ${card.href} must not promise a delivery`).toBe('');
          expect(card.hidden, `out-of-stock card ${card.href} must hide the empty slot`).toBe(
            'true',
          );
        } else {
          expect(
            card.text,
            `card ${card.href} in state "${card.state}" must keep the promise`,
          ).toBe(promise);
          expect(card.hidden, `card ${card.href} must expose the promise to AT`).toBeNull();
        }
        seenStates.add(card.state);
      }

      if (
        seenStates.has(copyFor(STATE_LABELS, locale).OUT_OF_STOCK) &&
        (seenStates.has(copyFor(STATE_LABELS, locale).IN_STOCK) ||
          seenStates.has(copyFor(STATE_LABELS, locale).LOW_STOCK))
      ) {
        break;
      }
    }

    // Both halves have to be proven on the card surface. Without the buyable
    // one, a gate that hid the promise on every card would read as a pass.
    expect(
      [...seenStates].includes(copyFor(STATE_LABELS, locale).OUT_OF_STOCK),
      `the card sweep must reach an out-of-stock card within ${CARD_SWEEP_PAGES} pages. ` +
        SEED_BAND_NOTE,
    ).toBe(true);
    expect(
      [...seenStates].some((state) =>
        [copyFor(STATE_LABELS, locale).IN_STOCK, copyFor(STATE_LABELS, locale).LOW_STOCK].includes(
          state,
        ),
      ),
      `the card sweep must also reach a buyable card. ${SEED_BAND_NOTE}`,
    ).toBe(true);

    await reloadAndAssertClean(page, outRoute, baseline, {
      afterReload: async () => {
        await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
        await expect(page.locator(PAGE_DELIVERY)).toHaveCount(0);
      },
    });
  });
});
