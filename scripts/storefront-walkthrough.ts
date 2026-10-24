/**
 * Runs the flow the build-a-storefront track documents against a running
 * engine and prints every request and response as the transcript the pages
 * paste from. The script is the proof that no response was typed.
 *
 *   npm run docs:walkthrough -- --base http://localhost:53000/api --locales en,fr
 *   npm run docs:walkthrough -- --origin http://localhost:53300   (the storefront origin CORS allows)
 *
 * Reads run once per locale with `Accept-Language` set; mutations run once,
 * under the first locale. Exits non-zero on any status of 500 or above, on a
 * retried order that came back as a different order, or on a step the flow
 * could not reach. Node 22's global `fetch` and a hand-rolled cookie jar; no
 * dependency.
 */
import { randomUUID } from 'node:crypto';
import {
  CookieJar,
  compareRetry,
  formatStep,
  orderIdOf,
  parseArgs,
  summaryLine,
  type StepRecord,
} from './storefront-walkthrough-lib';

type Json = Record<string, unknown>;
const field = (value: unknown, ...keys: (string | number)[]): unknown =>
  keys.reduce<unknown>((acc, key) => (acc as Json | undefined)?.[key as string], value);
const text = (value: unknown, ...keys: (string | number)[]): string | undefined => {
  const found = field(value, ...keys);
  return typeof found === 'string' ? found : undefined;
};

interface RequestInit {
  locale: string;
  body?: unknown;
  headers?: Record<string, string>;
  note?: string;
}

class Walkthrough {
  readonly jar = new CookieJar();
  requests = 0;
  failures = 0;

  constructor(private readonly base: string) {}

  async request(method: string, path: string, init: RequestInit): Promise<StepRecord> {
    const requestHeaders: Record<string, string> = { 'Accept-Language': init.locale };
    if (init.body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    Object.assign(requestHeaders, init.headers);
    const cookie = this.jar.header();
    if (cookie) requestHeaders.Cookie = cookie;

    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: requestHeaders,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
    });
    const raw = await response.text();
    let body: unknown = raw;
    try {
      body = raw === '' ? '' : JSON.parse(raw);
    } catch {
      body = raw;
    }
    const responseHeaders: Record<string, string[]> = {};
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') responseHeaders[name] = [value];
    }
    const setCookie = response.headers.getSetCookie();
    if (setCookie.length) responseHeaders['set-cookie'] = setCookie;
    this.jar.store(setCookie);

    const step: StepRecord = {
      method,
      path,
      locale: init.locale,
      requestHeaders,
      requestBody: init.body,
      status: response.status,
      responseHeaders,
      body,
      note: init.note,
    };
    this.requests += 1;
    if (response.status >= 500) this.failures += 1;
    process.stdout.write(formatStep(step) + '\n');
    return step;
  }

  /** A run-time fact the flow needs and did not get: counted as a failure, the flow goes on where it can. */
  fail(message: string): void {
    this.failures += 1;
    process.stdout.write(`failure: ${message}\n\n`);
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const walk = new Walkthrough(options.base);
  process.stdout.write(`# storefront walkthrough against ${options.base}\n\n`);

  // The store config seeds the locale list when the caller gave none, so the
  // first read carries no Accept-Language: there is no locale to state yet.
  let locales = options.locales;
  if (locales.length === 0) {
    const probe = await walk.request('GET', '/v1/store/config', { locale: '(none)' });
    const supported = field(probe.body, 'data', 'localization', 'supportedLocales');
    locales = Array.isArray(supported) ? supported.map(String) : [];
    if (locales.length === 0) {
      walk.fail('the store config carries no localization.supportedLocales');
      return 1;
    }
  }
  const [first] = locales;
  const config = await walk.request('GET', '/v1/store/config', { locale: first });
  for (const locale of locales.slice(1)) await walk.request('GET', '/v1/store/config', { locale });
  const country = text(config.body, 'data', 'identity', 'address', 'country') ?? 'FR';

  // ── Catalogue ──────────────────────────────────────────────────────────
  for (const locale of locales) await walk.request('GET', '/v1/categories', { locale });
  const products = await walk.request('GET', '/v1/products?page=1&pageSize=2', { locale: first });
  for (const locale of locales.slice(1)) {
    await walk.request('GET', '/v1/products?page=1&pageSize=2', { locale });
  }
  const slug = text(products.body, 'data', 0, 'slug');
  if (!slug) {
    walk.fail('GET /v1/products answered no product to continue with');
    return 1;
  }
  let variantId: string | undefined;
  for (const locale of locales) {
    const detail = await walk.request('GET', `/v1/products/${slug}`, { locale });
    variantId ??= text(detail.body, 'data', 'variants', 0, 'id');
    // The first word of the product's name in that locale; a bare ratio or
    // number such as "1:1" is skipped for the first word with letters in it.
    const name = text(detail.body, 'data', 'name') ?? '';
    const word = name.split(/\s+/).find((w) => /\p{L}{3,}/u.test(w)) ?? name.split(/\s+/)[0];
    await walk.request('GET', `/v1/search?q=${encodeURIComponent(word)}`, { locale });
  }

  // ── Cart ───────────────────────────────────────────────────────────────
  if (!variantId) {
    walk.fail(`GET /v1/products/${slug} answered no variant to add to the cart`);
    return 1;
  }
  await walk.request('POST', '/v1/cart/items', { locale: first, body: { variantId, quantity: 1 } });
  const cart = await walk.request('GET', '/v1/cart', { locale: first });
  for (const locale of locales.slice(1)) await walk.request('GET', '/v1/cart', { locale });

  // ── Account ────────────────────────────────────────────────────────────
  const email = `walkthrough-${Date.now()}@l5.example`;
  const password = `Walkthrough-${randomUUID().slice(0, 8)}`;
  // A request that carries a cookie (the cart's sessionId here) must also carry
  // an Origin the engine allows, or Better Auth answers 403 MISSING_OR_NULL_ORIGIN.
  const origin = { Origin: options.origin };
  await walk.request('POST', '/v1/auth/sign-up/email', {
    locale: first,
    body: { email, password, name: 'Walk Through', firstName: 'Walk', lastName: 'Through' },
    headers: origin,
    note: 'Origin is sent because the request carries the cart cookie; a browser sends it by itself',
  });
  const signIn = await walk.request('POST', '/v1/auth/sign-in/email', {
    locale: first,
    body: { email, password },
    headers: origin,
    note:
      'the engine requires a verified email before sign-in (emailAndPassword.requireEmailVerification), ' +
      'so a fresh account is refused here; the flow continues as a guest, which the demo store allows',
  });
  const signedIn = signIn.status === 200 && walk.jar.has('better-auth.session_token');
  await walk.request('GET', '/v1/auth/get-session', {
    locale: first,
    note: signedIn ? 'signed in' : 'not signed in: the session is null and the flow stays a guest',
  });
  if (signedIn) await walk.request('POST', '/v1/cart/merge', { locale: first });

  // ── Checkout ───────────────────────────────────────────────────────────
  for (const locale of locales) await walk.request('GET', '/v1/checkout/settings', { locale });
  const items = (field(cart.body, 'data', 'items') as unknown[] | undefined) ?? [];
  const ratesBody = {
    country,
    postalCode: '69001',
    items: items.map((item) => ({
      weight: Number(field(item, 'variant', 'weight') ?? 0),
      quantity: Number(field(item, 'quantity') ?? 1),
    })),
    subtotal: Number(field(cart.body, 'data', 'subtotal') ?? 0),
  };
  const rates = await walk.request('POST', '/v1/shipping/rates', {
    locale: first,
    body: ratesBody,
  });
  for (const locale of locales.slice(1)) {
    await walk.request('POST', '/v1/shipping/rates', { locale, body: ratesBody });
  }
  const shippingMethodId = text(rates.body, 'data', 0, 'methodId');

  const address = {
    fullName: 'Walk Through',
    phone: '+33100000000',
    addressLine1: '1 Rue de la Démo',
    city: 'Lyon',
    postalCode: '69001',
    country,
  };
  const orderBody = {
    ...(signedIn ? {} : { guestEmail: email }),
    shippingAddress: address,
    billingAddress: address,
    ...(shippingMethodId ? { shippingMethodId } : {}),
    paymentMethodCode: 'cod',
  };
  const key = randomUUID();
  const headers = { 'X-Idempotency-Key': key };
  const created = await walk.request('POST', '/v1/orders', {
    locale: first,
    body: orderBody,
    headers,
  });
  const retried = await walk.request('POST', '/v1/orders', {
    locale: first,
    body: orderBody,
    headers,
    note: 'the same X-Idempotency-Key and the same body: the engine must answer the same order',
  });
  const retry = compareRetry(created.body, retried.body);
  process.stdout.write(`${retry.line}\n\n`);
  if (!retry.same) walk.failures += 1;

  // ── Confirmation read-back ─────────────────────────────────────────────
  const orderId = orderIdOf(created.body);
  const orderNumber = text(created.body, 'data', 'orderNumber');
  if (!orderId) {
    walk.fail('POST /v1/orders answered no order id to read back');
  } else {
    for (const locale of locales) await walk.request('GET', `/v1/orders/${orderId}`, { locale });
  }
  if (!signedIn && orderNumber) {
    for (const locale of locales) {
      await walk.request('POST', '/v1/orders/track', { locale, body: { orderNumber, email } });
    }
  }

  process.stdout.write(`${summaryLine(walk.requests, walk.failures)}\n`);
  return walk.failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`walkthrough aborted: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
