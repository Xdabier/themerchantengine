import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  authCookieHeader,
  describeEveryLocale,
  reloadAndAssertClean,
  signUpViaApi,
  STOREFRONT_API_BASE,
  type AuthSession,
  type ConsoleBaseline,
} from './support';

/**
 * The browser logs the 401 the anonymous wishlist click deliberately provokes.
 * That is the browser reporting the status the test is asserting, not an
 * application fault.
 */
const EXPECTED_ANONYMOUS_401 = [/Failed to load resource.*401/i, /\/v1\/wishlist\//i];

/**
 * Wishlist add/remove journey — fills the GAP flagged by
 * test-coverage-auditor 2026-05-14 against goal-set
 * "every feature should be journey tested back to back".
 *
 * `account.journey.spec.ts` covers the wishlist page SSR shell + axe sweep
 * only; this spec drives the real customer add/remove path: PDP wishlist
 * toggle → /account/wishlist row → wishlist-row remove → empty state.
 *
 * Admin has no wishlist surface (wishlist is customer-only per the v1
 * scope), so this spec carries the entire feature.
 *
 * Per constitution §3.8: no `page.route()`, no fixtures, no mocks — drives
 * the live storefront against the real test API on 53001 (or wherever
 * `STOREFRONT_E2E_API_PORT` moves it, per the same Windows port-exclusion
 * carve-out used by `cart.journey.spec.ts`).
 *
 * The whole file used to sit behind `STOREFRONT_E2E_BUILT`, so it ran on no
 * tier anybody executes. The remove flow in particular has to run on the dev
 * tier, because the Vite `/v1` proxy the dev tier serves through is where the
 * remove was failing — a production-build-only journey cannot see that.
 */

const SEED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';

interface WishlistFixture {
  session: AuthSession;
  productId: string;
}

async function addToWishlist(
  req: APIRequestContext,
  auth: WishlistFixture,
  locale: string,
): Promise<void> {
  const res = await req.post(
    `${STOREFRONT_API_BASE}/v1/wishlist/${encodeURIComponent(auth.productId)}`,
    {
      headers: {
        Cookie: authCookieHeader(auth.session),
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': locale,
      },
    },
  );
  expect(res.ok(), `wishlist add must succeed: ${await res.text()}`).toBe(true);
}

/**
 * First ACTIVE product the catalogue grades at `availability`. Derived from
 * the API rather than hardcoded, so a reseed cannot silently turn the
 * out-of-stock assertion into a test against an in-stock row.
 */
async function findProductByAvailability(
  req: APIRequestContext,
  availability: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK',
): Promise<{ id: string; slug: string } | null> {
  const res = await req.get(`${STOREFRONT_API_BASE}/v1/products?pageSize=100`);
  expect(res.ok(), 'catalogue fetch must succeed').toBe(true);
  const body = await res.json();
  for (const product of body.data as Array<{
    id: string;
    slug: string;
    variants?: Array<{ availability?: string }>;
  }>) {
    const grades = (product.variants ?? []).map((v) => v.availability);
    if (grades.length && grades.every((g) => g === availability)) {
      return { id: product.id, slug: product.slug };
    }
  }
  return null;
}

async function registerAndFetchProduct(req: APIRequestContext): Promise<WishlistFixture> {
  const email = `s11-wishlist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
  const session = await signUpViaApi(req, {
    email,
    password: 'Fixture-Test-123!',
    firstName: 'Wish',
    lastName: 'List',
  });

  const productRes = await req.get(`${STOREFRONT_API_BASE}/v1/products/${SEED_PRODUCT_SLUG}`);
  expect(productRes.ok(), 'seed product fetch must succeed').toBe(true);
  const productBody = await productRes.json();
  const productId = (productBody.data ?? productBody).id as string;
  expect(productId, 'seed product must expose an id').toBeTruthy();

  return { session, productId };
}

describeEveryLocale('storefront wishlist add/remove journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`empty wishlist on /${locale}/account/wishlist renders empty state for fresh customer`, async ({
    page,
    request,
  }) => {
    const auth = await registerAndFetchProduct(request);
    await attachAuthToBrowser(page, auth.session);

    await page.goto(`/${locale}/account/wishlist`);
    await expect(page.getByTestId('account-wishlist-page')).toBeVisible();
    await expect(page.getByTestId('account-wishlist-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('account-wishlist-empty-cta')).toBeVisible();
  });

  test(`customer adds via API → wishlist row visible on /${locale}/account/wishlist → remove clears it`, async ({
    page,
    request,
  }) => {
    const auth = await registerAndFetchProduct(request);

    await addToWishlist(request, auth, locale);

    await attachAuthToBrowser(page, auth.session);
    await page.goto(`/${locale}/account/wishlist`);
    await expect(page.getByTestId('account-wishlist-page')).toBeVisible();
    const row = page.getByTestId(`wishlist-row-${auth.productId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`wishlist-row-remove-${auth.productId}`).locator('button').click();

    await expect(page.getByTestId('account-wishlist-empty')).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId('account-wishlist-status')).toContainText(/.+/);

    // The remove crosses the Vite `/v1` proxy on this tier. Assert the row is
    // gone from the SERVER too, not just from the in-memory list the mutation
    // refetched: a relay that drops the request would leave both looking the
    // same until the next cold load.
    await reloadAndAssertClean(page, `/${locale}/account/wishlist`, baseline, {
      afterReload: async () => {
        await expect(page.getByTestId('account-wishlist-empty')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId(`wishlist-row-${auth.productId}`)).toHaveCount(0);
      },
    });
  });

  // Finding W1. The toggle used to boot its own `signal(false)` with nothing
  // anywhere fetching membership, so the heart came back empty after every
  // reload even in the same browser, and the next click silently re-added.
  test(`wishlisted product renders a pressed heart on /${locale} without any click, and survives a reload`, async ({
    page,
    request,
  }) => {
    const auth = await registerAndFetchProduct(request);
    await addToWishlist(request, auth, locale);
    await attachAuthToBrowser(page, auth.session);

    await page.goto(`/${locale}/catalog/product/${SEED_PRODUCT_SLUG}`);
    await expect(page.getByTestId('product-summary')).toBeVisible({ timeout: 15_000 });

    const toggle = page.locator('wishlist-toggle button').first();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    await reloadAndAssertClean(page, `/${locale}/catalog/product/${SEED_PRODUCT_SLUG}`, baseline, {
      afterReload: async () => {
        await expect(page.getByTestId('product-summary')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('wishlist-toggle button').first()).toHaveAttribute(
          'aria-pressed',
          'true',
          { timeout: 15_000 },
        );
      },
    });
  });

  // Membership has to come from the server, not from anything the tab kept.
  // A second browser context shares no memory, no storage and no in-page
  // state with the first, so a pressed heart here can only be hydrated.
  test(`wishlist membership hydrates in a fresh browser context on /${locale}`, async ({
    page,
    request,
    browser,
  }) => {
    const auth = await registerAndFetchProduct(request);
    await addToWishlist(request, auth, locale);

    await attachAuthToBrowser(page, auth.session);
    await page.goto(`/${locale}/catalog/product/${SEED_PRODUCT_SLUG}`);
    await expect(page.locator('wishlist-toggle button').first()).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 15_000 },
    );

    const secondContext = await browser.newContext();
    try {
      const secondPage = await secondContext.newPage();
      const secondBaseline = attachConsoleBaseline(secondPage);
      await secondContext.addCookies(auth.session.cookies);

      await secondPage.goto(`/${locale}/catalog/product/${SEED_PRODUCT_SLUG}`);
      await expect(secondPage.getByTestId('product-summary')).toBeVisible({ timeout: 15_000 });
      await expect(secondPage.locator('wishlist-toggle button').first()).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 15_000 },
      );
      secondBaseline.assertClean();
    } finally {
      await secondContext.close();
    }
  });

  // Finding W6. The 401 redirect was already wired globally in app.config.ts
  // but had never been observed in a browser, and nothing told the visitor why
  // they had landed on the login page.
  test(`anonymous heart click on /${locale}/catalog lands on login with from= and a visible reason`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/catalog`);
    const heart = page.locator('wishlist-toggle button').first();
    await expect(heart).toBeVisible({ timeout: 15_000 });

    await heart.click();

    await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });
    const url = new URL(page.url());
    expect(url.pathname).toContain(`/${locale}/auth/login`);
    expect(url.searchParams.get('from')).toContain(`/${locale}/catalog`);

    // Root-scoped, so it survives the navigation the global handler performs.
    const toast = page.getByTestId('toast-warning');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).not.toHaveText('');

    baseline.assertClean({ ignore: EXPECTED_ANONYMOUS_401 });
    baseline.reset();
  });

  // Findings W3 and W4. The row rendered the branded placeholder on every
  // product because the API sent no asset, and its primary action threw
  // client-side because it sent no variant id.
  test(`wishlist row on /${locale} shows the real image and adds to the cart`, async ({
    page,
    request,
  }) => {
    const auth = await registerAndFetchProduct(request);
    await addToWishlist(request, auth, locale);
    await attachAuthToBrowser(page, auth.session);

    await page.goto(`/${locale}/account/wishlist`);
    const row = page.getByTestId(`wishlist-row-${auth.productId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const image = row.locator('app-picture img').first();
    await expect(image).toBeVisible();
    const src = await image.getAttribute('src');
    expect(src, 'the row must render the real primary asset').toBeTruthy();
    expect(src).not.toContain('/brand/no-image');

    const addButton = row.getByTestId(`wishlist-row-add-${auth.productId}`).locator('button');
    await expect(addButton).toBeEnabled();
    await addButton.click();

    await expect(page.getByTestId('account-wishlist-status')).toContainText(/.+/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('header-cart-badge')).toHaveText('1', { timeout: 15_000 });

    await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
      afterReload: async () => {
        await expect(page.locator('[data-testid-shared="cart-line"]')).toHaveCount(1, {
          timeout: 15_000,
        });
      },
    });
  });

  test(`out-of-stock wishlist row on /${locale} says so and refuses add to cart`, async ({
    page,
    request,
  }) => {
    const soldOut = await findProductByAvailability(request, 'OUT_OF_STOCK');
    test.skip(!soldOut, 'the seeded catalogue holds no fully out-of-stock product');

    const auth = await registerAndFetchProduct(request);
    const target = { ...auth, productId: soldOut!.id };
    await addToWishlist(request, target, locale);
    await attachAuthToBrowser(page, auth.session);

    await page.goto(`/${locale}/account/wishlist`);
    const row = page.getByTestId(`wishlist-row-${soldOut!.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const pill = row.getByTestId('wishlist-row-availability');
    await expect(pill).toHaveAttribute('data-state', 'out');
    await expect(pill).not.toHaveText('');
    await expect(row.getByTestId('wishlist-row-oos')).toBeVisible();
    await expect(
      row.getByTestId(`wishlist-row-add-${soldOut!.id}`).locator('button'),
    ).toBeDisabled();

    await reloadAndAssertClean(page, `/${locale}/account/wishlist`, baseline, {
      afterReload: async () => {
        await expect(
          page.getByTestId(`wishlist-row-${soldOut!.id}`).getByTestId('wishlist-row-availability'),
        ).toHaveAttribute('data-state', 'out', { timeout: 15_000 });
      },
    });
  });

  // Finding T7. "Save for later" moved the product into the wishlist and
  // deleted the cart line, then said nothing; the saved-for-later section the
  // label implied could never appear, because GET /v1/cart has no such field.
  // Lives here rather than in cart.journey because that spec runs on the
  // mobile projects too, and no authed dev-tier journey does (see its header).
  //
  // The cart's move-to-wishlist adds the product
  // server-side, and the cart line carries no productId on the wire, so a
  // store that patched its set locally could not know which product just
  // became wishlisted. Only a re-read gets the heart right.
  test(`moving a cart line to the wishlist refreshes the heart on /${locale}`, async ({
    page,
    request,
  }) => {
    const auth = await registerAndFetchProduct(request);

    const variantRes = await request.get(`${STOREFRONT_API_BASE}/v1/products/${SEED_PRODUCT_SLUG}`);
    expect(variantRes.ok()).toBe(true);
    const variantId = ((await variantRes.json()).data.variants ?? [])[0]?.id as string;
    expect(variantId, 'seed product must expose a variant').toBeTruthy();

    const added = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
      headers: { Cookie: authCookieHeader(auth.session), 'Accept-Language': locale },
      data: { variantId, quantity: 1 },
    });
    expect(added.ok(), `authed cart add must succeed: ${await added.text()}`).toBe(true);

    await attachAuthToBrowser(page, auth.session);
    await page.goto(`/${locale}/cart`);
    const moveButton = page.locator('[data-testid^="cart-line-save-"] button').first();
    await expect(moveButton).toBeVisible({ timeout: 15_000 });
    await expect(moveButton).not.toHaveText('');
    await moveButton.click();

    const status = page.getByTestId('cart-move-status');
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status).not.toHaveText('');
    // The line leaves the cart. That is the whole action: there is no
    // saved-for-later pool for it to land in.
    await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="cart-line-"]')).toHaveCount(0);

    // The confirmation's link is the route back to what just happened.
    await status.locator('a').click();
    await page.waitForURL(new RegExp(`/${locale}/account/wishlist`), { timeout: 15_000 });
    await expect(page.getByTestId(`wishlist-row-${auth.productId}`)).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(`/${locale}/catalog/product/${SEED_PRODUCT_SLUG}`);
    await expect(
      page.getByTestId('product-summary').locator('wishlist-toggle button'),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

    await reloadAndAssertClean(page, `/${locale}/account/wishlist`, baseline, {
      afterReload: async () => {
        await expect(page.getByTestId(`wishlist-row-${auth.productId}`)).toBeVisible({
          timeout: 15_000,
        });
      },
    });
  });

  test(`PDP wishlist-toggle press on /${locale}/catalog/product/${SEED_PRODUCT_SLUG} surfaces row on /account/wishlist`, async ({
    page,
    request,
  }) => {
    const auth = await registerAndFetchProduct(request);
    await attachAuthToBrowser(page, auth.session);

    await page.goto(`/${locale}/catalog/product/${SEED_PRODUCT_SLUG}`);
    await expect(page.getByTestId('product-summary')).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByTestId('product-summary').locator('wishlist-toggle button');
    await expect(toggle).toBeVisible();

    // Finding W5: in the buy box this was a bare 20px glyph. It carries a
    // visible label now, and that label is the accessible name, so a voice
    // user saying what they see actually activates it (WCAG 2.5.3). Read from
    // the page rather than hardcoded, so the assertion holds in both locales.
    // Scoped to the buy box: the related-products rail below carries overlay
    // toggles with the same accessible name.
    const buyBox = page.getByTestId('product-summary');
    const label = buyBox.getByTestId('wishlist-toggle-label');
    await expect(label).toBeVisible();
    const labelText = (await label.innerText()).trim();
    expect(labelText.length).toBeGreaterThan(0);
    expect(await toggle.getAttribute('aria-label')).toBe(labelText);
    await expect(buyBox.getByRole('button', { name: labelText, exact: true })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    // The label follows the state the same way the accessible name does.
    await expect(label).not.toHaveText(labelText);

    await page.goto(`/${locale}/account/wishlist`);
    await expect(page.getByTestId(`wishlist-row-${auth.productId}`)).toBeVisible({
      timeout: 15_000,
    });
  });
});
