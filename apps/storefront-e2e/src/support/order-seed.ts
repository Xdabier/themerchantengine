import { expect, type APIRequestContext } from '@playwright/test';

import {
  authCookieHeader,
  signInViaApi,
  STOREFRONT_API_BASE,
  type AuthSession,
} from './auth-attach';
import type { StorefrontLocale } from './locale-matrix';
import { fixtureShippableAddress } from './store-config-fixture';

/**
 * Order seeding for storefront journeys that need a customer who has actually
 * received a product.
 *
 * Review eligibility is decided by a DELIVERED (or COMPLETED) order carrying
 * the product, and the fresh test seed plants exactly one such order, on one
 * product, for one customer. Every reviews journey that reused it contended
 * for the single `[productId, userId]` review row that customer may own, and
 * `describeEveryLocale` runs the fr and en branches in parallel, so the two
 * branches raced each other into 409s.
 *
 * These helpers give a journey its own customer, its own order and therefore
 * its own review slot. The status walk goes through the real admin endpoint,
 * so it also exercises the transition map in `orders.constants.ts` rather than
 * writing a status straight into the database.
 */

/** The seeded SUPER_ADMIN, mirroring `ADMIN` in `test/e2e/helpers.ts`. */
export const STOREFRONT_E2E_ADMIN = {
  email: 'admin@merchants.test',
  password: 'password123',
};

export function apiHeaders(auth: AuthSession, locale: StorefrontLocale): Record<string, string> {
  return {
    Cookie: authCookieHeader(auth),
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': locale,
  };
}

export async function signInAsAdmin(request: APIRequestContext): Promise<AuthSession> {
  return signInViaApi(request, STOREFRONT_E2E_ADMIN.email, STOREFRONT_E2E_ADMIN.password);
}

/**
 * An ACTIVE product with one stocked variant, created through the admin API.
 *
 * A journey that publishes reviews or questions and then asserts on the
 * aggregate cannot share a product: `describeEveryLocale` runs the fr and en
 * branches in parallel, so a count read a moment ago is already stale by the
 * time the page paints. A product of its own makes the arithmetic the test's
 * alone.
 */
export async function seedProduct(
  request: APIRequestContext,
  locale: StorefrontLocale,
  tag: string,
): Promise<{ slug: string; variantId: string }> {
  const adminAuth = await signInAsAdmin(request);
  const headers = apiHeaders(adminAuth, locale);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const category = await request.post(`${STOREFRONT_API_BASE}/v1/admin/categories`, {
    headers,
    data: { name: { default: `E2E ${tag} category` }, slug: `e2e-${tag}-cat-${stamp}` },
  });
  expect(category.ok(), `create category: ${await category.text()}`).toBe(true);
  const categoryId = (await category.json()).data.id as string;

  const product = await request.post(`${STOREFRONT_API_BASE}/v1/admin/products`, {
    headers,
    data: {
      name: { default: `E2E ${tag} product` },
      slug: `e2e-${tag}-product-${stamp}`,
      description: { default: `Seeded for the ${tag} journey.` },
      status: 'ACTIVE',
      categoryIds: [categoryId],
      variants: [{ sku: `E2E-${tag.toUpperCase()}-${stamp}`, price: 100 }],
    },
  });
  expect(product.ok(), `create product: ${await product.text()}`).toBe(true);
  const created = (await product.json()).data;
  const variantId = created.variants[0].id as string;

  const location = await request.get(`${STOREFRONT_API_BASE}/v1/admin/inventory/locations`, {
    headers,
  });
  expect(location.ok(), `list locations: ${await location.text()}`).toBe(true);
  const locationId = ((await location.json()).data ?? [])[0]?.id as string | undefined;
  expect(locationId, 'the test seed must plant at least one inventory location').toBeTruthy();

  const adjusted = await request.patch(`${STOREFRONT_API_BASE}/v1/admin/inventory/adjust`, {
    headers: { ...headers, 'X-Idempotency-Key': crypto.randomUUID() },
    data: { variantId, locationId, quantity: 50, reason: 'RECEIVED' },
  });
  expect(adjusted.ok(), `stock variant: ${await adjusted.text()}`).toBe(true);

  return { slug: created.slug as string, variantId };
}

/** Every hop from PENDING to COMPLETED, in order, per `STATUS_TRANSITIONS`. */
const STATUS_WALK = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'] as const;

/**
 * Where a seeded order can be parked. `PENDING` is the order as placed, with no
 * admin transition at all: it is the one status that issues no invoice, which
 * the M4 invoice journey needs.
 */
export type SeedOrderTarget = (typeof STATUS_WALK)[number] | 'PENDING';

export interface SeededOrder {
  id: string;
  /** Human-facing number. The public track endpoint is keyed by this, not `id`. */
  orderNumber: string;
  items: Array<{ id: string; productId?: string | null }>;
}

/**
 * Place an order for `productSlug` as `auth`, then walk it to `targetStatus`
 * (`DELIVERED` or `COMPLETED`) through the admin status endpoint.
 */
export async function seedOrderInStatus(
  request: APIRequestContext,
  auth: AuthSession,
  locale: StorefrontLocale,
  productSlug: string,
  targetStatus: SeedOrderTarget = 'DELIVERED',
): Promise<SeededOrder> {
  const headers = apiHeaders(auth, locale);

  const me = await request.get(`${STOREFRONT_API_BASE}/v1/users/me`, { headers });
  expect(me.status(), `GET /v1/users/me: ${await me.text()}`).toBe(200);
  let addressId = ((await me.json()).data?.addresses ?? [])[0]?.id as string | undefined;
  if (!addressId) {
    const created = await request.post(`${STOREFRONT_API_BASE}/v1/users/me/addresses`, {
      headers,
      data: {
        ...fixtureShippableAddress({ fullName: 'Reviews Customer' }),
        isDefaultShipping: true,
      },
    });
    expect(created.ok(), `create address: ${await created.text()}`).toBe(true);
    addressId = (await created.json()).data.id as string;
  }

  const product = await request.get(`${STOREFRONT_API_BASE}/v1/products/${productSlug}`);
  expect(product.status()).toBe(200);
  const variantId = (await product.json()).data?.variants?.[0]?.id as string | undefined;
  expect(variantId, `product ${productSlug} must expose a variant`).toBeTruthy();

  const added = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
    headers,
    data: { variantId, quantity: 1 },
  });
  expect(added.ok(), `add to cart: ${await added.text()}`).toBe(true);

  const placed = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
    headers: {
      ...headers,
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    data: { shippingAddressId: addressId },
  });
  expect(placed.status(), `place order: ${await placed.text()}`).toBe(201);
  const order = (await placed.json()).data as SeededOrder;

  const adminAuth = await signInAsAdmin(request);
  const adminHeaders = apiHeaders(adminAuth, locale);
  // Stop at the requested rung. Parking an order at CONFIRMED matters for the
  // cancel seam: that is the last status where the customer may still act, and
  // `PENDING` is not on the walk at all, so it takes no hops.
  const hops =
    targetStatus === 'PENDING' ? [] : STATUS_WALK.slice(0, STATUS_WALK.indexOf(targetStatus) + 1);
  for (const status of hops) {
    const res = await request.patch(`${STOREFRONT_API_BASE}/v1/admin/orders/${order.id}/status`, {
      headers: adminHeaders,
      data: { status },
    });
    expect(res.status(), `walk order to ${status}: ${await res.text()}`).toBe(200);
  }

  return order;
}
