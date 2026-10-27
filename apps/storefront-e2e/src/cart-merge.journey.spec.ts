import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  signUpViaApi,
  STOREFRONT_API_BASE,
  type ConsoleBaseline,
} from './support';

/**
 * Anonymous cart survives sign-in (plan F phase F2, finding K4 / pass-2 A9).
 *
 * `CartService.mergeAnonymousCart` was written and unit-tested when the cart
 * module was built, and the Better Auth cutover then deleted the custom login
 * controller that was its only caller. Nothing re-wired it, so from that day
 * signing in silently threw the guest basket away. The unit suite stayed green
 * throughout, because the function itself was never broken: only its call site
 * was. That is exactly the gap a journey closes.
 *
 * Two call sites, two tiers:
 *
 *   - The **layout shell boot** covers every sign-in that lands as a full page
 *     load: magic-link verify, and the auto sign-in after email verification.
 *     Reachable on the dev tier, because the session can be seeded as cookies
 *     and the boot then runs for real.
 *   - The **login form** covers the SPA path, which is the A9 repro proper: a
 *     guest at `/checkout` is bounced to login with `?from=`, signs in, and the
 *     router navigates on with no page load, so the boot merge never fires.
 *     That one needs a real UI sign-in, and every UI sign-in journey in this
 *     suite is gated behind `STOREFRONT_E2E_BUILT` (`auth.journey.spec.ts:184`)
 *     because the Vite dev server does not complete the Better Auth submit
 *     inside the per-test budget: the button stays stuck in its loading state.
 *     Same gate here, rather than a fourth flaky dev-tier sign-in.
 *
 * Desktop-only. Every authed dev-tier journey in a mobile project is already
 * gated for the same class of reason: WebKit on the Vite dev server blocks the
 * shell's boot cart fetch, which trips the console baseline.
 */

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

const STOREFRONT_ORIGIN =
  process.env['BASE_URL'] ?? `http://localhost:${process.env['STOREFRONT_DEV_PORT'] ?? '53311'}`;

const PASSWORD = 'Fixture-Test-123!';

function uniqueEmail(prefix: string): string {
  return `f2-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
}

/**
 * Add one line as an anonymous visitor, returning the minted `sessionId`.
 *
 * Walks the catalogue and keeps trying until an add is actually accepted,
 * rather than trusting a stock field on the list payload. The list does not
 * carry per-variant availability, so picking the first variant and asserting
 * success made this spec fail with a 400 on whichever product the seed happens
 * to leave short, and every e2e run that places an order moves that target.
 */
async function addLineAsGuest(req: APIRequestContext): Promise<string> {
  const res = await req.get(`${STOREFRONT_API_BASE}/v1/products?pageSize=24`);
  expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
  const body = (await res.json()) as { data?: unknown };
  const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

  const variantIds: string[] = [];
  for (const row of rows) {
    for (const variant of (row as { variants?: unknown[] }).variants ?? []) {
      const id = (variant as { id?: string }).id;
      if (id) variantIds.push(id);
    }
  }
  expect(variantIds.length, 'seeded catalogue must expose at least one variant').toBeGreaterThan(0);

  for (const variantId of variantIds) {
    const add = await req.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
      data: { variantId, quantity: 1 },
    });
    if (![200, 201].includes(add.status())) continue;
    const setCookie = add.headers()['set-cookie'] ?? '';
    const match = /sessionId=([^;]+)/.exec(setCookie);
    expect(match?.[1], 'anonymous add must mint the sessionId cookie').toBeTruthy();
    return match![1];
  }

  throw new Error('no seeded variant could be added to an anonymous cart');
}

async function applyGuestCookie(context: BrowserContext, value: string): Promise<void> {
  await context.addCookies([
    {
      name: 'sessionId',
      value,
      url: STOREFRONT_ORIGIN,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Drop only the anonymous cart cookie, keeping the Better Auth session.
 *
 * This is the step the first draft of this spec was missing, and it is the
 * whole reason the test can fail at all. A merge that ran clears the cookie
 * server-side; a merge that never ran leaves it in place, and `GET /v1/cart`
 * then answers with the GUEST cart, which of course still holds the line. The
 * first draft passed with both call sites deleted. With the cookie gone there
 * is exactly one cart the API can answer with: the customer's.
 */
async function clearGuestCookie(context: BrowserContext): Promise<void> {
  // Targeted by name. Clearing the whole jar and re-adding the survivors does
  // NOT round-trip a Better Auth session: the re-added cookies come back
  // without the attributes the browser stored them with, so the next page load
  // booted anonymous, no merge ran, and the cart page rendered empty. That was
  // the intermittent failure this spec spent a while blaming on the endpoint.
  await context.clearCookies({ name: 'sessionId' });
}

/** `GET /v1/cart` as the browser currently is, returning the item count. */
async function cartItemCount(
  page: { request: APIRequestContext },
  locale: string,
): Promise<number> {
  const res = await page.request.get(`${STOREFRONT_API_BASE}/v1/cart`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept-Language': locale },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return (body.data ?? body).itemCount ?? 0;
}

describeEveryLocale('cart merge on sign-in', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a guest line survives a full-page-load sign-in (${locale})`, async ({ page, context }) => {
    const req = await apiRequest.newContext();
    try {
      const guestSession = await addLineAsGuest(req);

      // The session is established out of band, exactly as magic-link verify
      // and post-verification auto sign-in leave it: cookies already set when
      // the shell boots.
      const session = await signUpViaApi(req, {
        email: uniqueEmail('boot'),
        password: PASSWORD,
        firstName: 'Boot',
        lastName: 'Merge',
      });
      await attachAuthToBrowser(page, session);
      await applyGuestCookie(context, guestSession);

      // The full page load that runs the shell boot. Arm the waiter BEFORE the
      // navigation: `goto` resolves on `load`, while `boot()` is still awaiting
      // `getSession()` and has not fired the merge yet. Navigating on without
      // waiting aborts the request mid-flight, which is a lost basket that
      // looks exactly like a merge that never ran.
      const merged = page.waitForResponse((res) => res.url().includes('/v1/cart/merge'), {
        timeout: 60_000,
      });
      await page.goto(`/${locale}/`);
      await expect(page.getByTestId('header-catalog-link')).toBeVisible({ timeout: 60_000 });
      expect((await merged).status(), 'the boot merge must succeed').toBe(200);

      await clearGuestCookie(context);

      await page.goto(`/${locale}/cart`);
      await expect(page.getByTestId('cart-items')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('cart-empty')).toHaveCount(0);

      // The A9 symptom verbatim: itemCount 0 after signing in.
      expect(await cartItemCount(page, locale)).toBe(1);

      await reloadAndAssertClean(page, `/${locale}/cart`, baseline);
      await expect(page.getByTestId('cart-items')).toBeVisible({ timeout: 60_000 });
    } finally {
      await req.dispose();
    }
  });

  test(`a boot with no guest cart leaves the account cart empty (${locale})`, async ({ page }) => {
    // The merge fires on every authenticated boot, so the no-cookie path has to
    // be a clean no-op rather than a 4xx the console baseline would catch.
    const req = await apiRequest.newContext();
    try {
      const session = await signUpViaApi(req, {
        email: uniqueEmail('nomerge'),
        password: PASSWORD,
        firstName: 'Empty',
        lastName: 'Boot',
      });
      await attachAuthToBrowser(page, session);

      await page.goto(`/${locale}/cart`);
      await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 60_000 });
      expect(await cartItemCount(page, locale)).toBe(0);
    } finally {
      await req.dispose();
    }
  });

  if (STOREFRONT_E2E_BUILT) {
    test(`a guest line survives the checkout login bounce (${locale})`, async ({
      page,
      context,
    }) => {
      const req = await apiRequest.newContext();
      try {
        const guestSession = await addLineAsGuest(req);

        const email = uniqueEmail('bounce');
        await signUpViaApi(req, {
          email,
          password: PASSWORD,
          firstName: 'Bounce',
          lastName: 'Merge',
        });

        await applyGuestCookie(context, guestSession);

        // The bounce: an anonymous visitor at checkout is sent to login.
        await page.goto(`/${locale}/checkout`);
        await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login`), { timeout: 60_000 });
        expect(new URL(page.url()).searchParams.get('from')).toBe(`/${locale}/checkout`);

        await page.getByTestId('auth-login-email').fill(email);
        await page.getByTestId('auth-login-password').fill(PASSWORD);
        const merged = page.waitForResponse((res) => res.url().includes('/v1/cart/merge'), {
          timeout: 60_000,
        });
        await page.getByTestId('auth-login-submit').click();
        expect((await merged).status(), 'the sign-in merge must succeed').toBe(200);

        // Landing on `?from` proves the sign-in took. Without it the test
        // passes on a failed sign-in, because the visitor is then still the
        // guest whose cart holds the line. `toHaveURL`, not `waitForURL`: the
        // redirect is a router navigation and fires no `load` event.
        await expect(page).toHaveURL(new RegExp(`/${locale}/checkout`), { timeout: 60_000 });

        await clearGuestCookie(context);

        await page.goto(`/${locale}/cart`);
        await expect(page.getByTestId('cart-items')).toBeVisible({ timeout: 60_000 });
        expect(await cartItemCount(page, locale)).toBe(1);

        await reloadAndAssertClean(page, `/${locale}/cart`, baseline);
      } finally {
        await req.dispose();
      }
    });
  }
});
