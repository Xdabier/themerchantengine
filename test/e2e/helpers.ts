import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { registryLocaleCodes } from '@common/locale';
import {
  API_BASE_URL,
  DEFAULT_STORE_CONFIG_FIXTURE,
  TEST_DATABASE_URL,
  TEST_REDIS_HOST,
  TEST_REDIS_PORT,
  harnessStoreConfigFixture,
  loadStoreConfigFixture,
  type StoreConfigFixture,
} from './env';

export { API_BASE_URL } from './env';

/** A Supertest request bound to the e2e API instance. */
export const api = (): request.SuperTest<request.Test> => request(API_BASE_URL);

/** A standalone Prisma client on the test database — for spec setup / assertions. */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
}

/** Every `Set-Cookie` on a response, reduced to a `name=value; name2=value2` header. */
export function sessionCookie(res: request.Response): string {
  const raw: string | string[] = res.headers['set-cookie'] ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

/** A single named cookie's value from a response's `Set-Cookie`. */
export function extractCookie(res: request.Response, name: string): string | undefined {
  const raw: string | string[] = res.headers['set-cookie'] ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0].split('=').slice(1).join('=');
  }
  return undefined;
}

/**
 * Flush Better Auth's Redis rate-limit budget. The whole e2e suite signs in
 * and signs up from one origin (127.0.0.1), so without this the shared
 * 5-per-window sign-in / sign-up cap trips almost immediately. `loginAs` and
 * `signUpCustomer` call it; the rate-limit spec exercises the cap with raw
 * requests that deliberately do not.
 */
export async function clearRateLimit(): Promise<void> {
  await flushRedisKeys('ba:ratelimit:*');
}

/**
 * Delete every test-Redis key matching a glob. Best-effort, same bounded
 * connection as `clearRateLimit`.
 *
 * Used by specs that assert on a response the API caches: without a flush the
 * assertion reads whatever an earlier spec left behind, so a serializer change
 * would look applied (or not) purely by test order.
 */
export async function flushRedisKeys(pattern: string): Promise<void> {
  // Bounded timeouts + no reconnect loop: a Redis blip must fail fast here,
  // never hang a helper (`maxRetriesPerRequest: null` would retry forever).
  const redis = new Redis({
    host: TEST_REDIS_HOST,
    port: TEST_REDIS_PORT,
    lazyConnect: true,
    connectTimeout: 4000,
    commandTimeout: 4000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch {
    // best-effort
  } finally {
    redis.disconnect();
  }
}

/**
 * Sign in via Better Auth and return the session-cookie header — pass it to
 * `.set('Cookie', cookie)` on follow-up requests. Replaces the retired
 * "POST /login → Bearer token" helper.
 */
export async function loginAs(email: string, password: string): Promise<string> {
  await clearRateLimit();
  // Better Auth normalises email to lowercase; send the normalised form to avoid
  // a case-mismatch between what was stored and what sign-in looks up.
  const normalizedEmail = email.toLowerCase();
  const res = await api()
    .post('/v1/auth/sign-in/email')
    .send({ email: normalizedEmail, password })
    .expect(200);
  const cookie = sessionCookie(res);
  if (!cookie.includes('session')) {
    throw new Error(`loginAs(${email}): sign-in response carried no session cookie`);
  }
  return cookie;
}

/**
 * Sign up a customer through Better Auth, grandfather email verification (so
 * the sign-in is not gated on it), and return the session-cookie header.
 */
export async function signUpCustomer(
  prisma: PrismaClient,
  email: string,
  password: string,
  profile: { firstName?: string; lastName?: string } = {},
): Promise<string> {
  const firstName = profile.firstName ?? 'E2E';
  const lastName = profile.lastName ?? 'Customer';
  // Better Auth normalises email to lowercase on sign-up; all DB lookups must
  // use the same normalised form or the user row won't be found.
  const normalizedEmail = email.toLowerCase();
  await clearRateLimit();
  const signUpRes = await api()
    .post('/v1/auth/sign-up/email')
    .send({
      email: normalizedEmail,
      password,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
    });
  if (signUpRes.status >= 400) {
    throw new Error(
      `signUpCustomer(${normalizedEmail}): sign-up returned ${signUpRes.status} — ${JSON.stringify(signUpRes.body)}`,
    );
  }
  await prisma.user.update({ where: { email: normalizedEmail }, data: { emailVerified: true } });
  return loginAs(normalizedEmail, password);
}

/**
 * Create a staff / admin user directly: a `User` with the given base role, a
 * Better Auth `credential` Account, and — when `permissions` is given — a
 * `Role` carrying them, linked as the user's `customRole`. This is the current
 * RBAC model (Role / RolePermission); it replaces the removed `AdminProfile`.
 * Returns the created ids for teardown. Sign in afterwards with `loginAs`.
 */
export async function createUserWithRole(
  prisma: PrismaClient,
  opts: {
    email: string;
    password: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'SUPPORT' | 'CUSTOMER';
    permissions?: string[];
    firstName?: string;
    lastName?: string;
  },
): Promise<{ userId: string; roleId?: string }> {
  const passwordHash = await bcrypt.hash(opts.password, 4);
  let roleId: string | undefined;
  if (opts.permissions) {
    const role = await prisma.role.create({
      data: {
        name: `e2e-role-${Math.random().toString(36).slice(2, 10)}`,
        permissions: { create: opts.permissions.map((permission) => ({ permission })) },
      },
    });
    roleId = role.id;
  }
  const firstName = opts.firstName ?? 'E2E';
  const lastName = opts.lastName ?? 'Staff';
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      passwordHash,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      role: opts.role,
      emailVerified: true,
      ...(roleId ? { roleId } : {}),
    },
  });
  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: passwordHash,
    },
  });
  return { userId: user.id, roleId };
}

/**
 * The action URL of the most recent auth email of `templateCode` to
 * `recipient`, read from `NotificationLog` — the `AuthMailer` records
 * `metadata.actionUrl` outside production. Lets a spec follow a verification /
 * reset / magic-link without a real inbox. Retries briefly to absorb the gap
 * between the HTTP response and the async email dispatch.
 */
export async function recentActionUrl(
  prisma: PrismaClient,
  templateCode: 'auth.email-verification' | 'auth.password-reset' | 'auth.magic-link',
  recipient: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const log = await prisma.notificationLog.findFirst({
      where: { templateCode, recipient },
      orderBy: { sentAt: 'desc' },
    });
    const url = (log?.metadata as { actionUrl?: string } | null)?.actionUrl;
    if (url) return url;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`recentActionUrl: no ${templateCode} email logged for ${recipient}`);
}

/**
 * The token embedded in an auth action URL. Verification and magic-link URLs
 * carry it as a `?token=` query param; the password-reset URL carries it as
 * the final path segment (`/reset-password/<token>?callbackURL=…`).
 */
export function tokenOf(url: string): string {
  const parsed = new URL(url);
  const token =
    parsed.searchParams.get('token') ?? parsed.pathname.split('/').filter(Boolean).pop();
  if (!token) throw new Error(`tokenOf: no token found in ${url}`);
  return token;
}

/** Seed credentials — see prisma/seed.ts. */
export const ADMIN = { email: 'admin@merchants.test', password: 'password123' };
export const CUSTOMER1 = { email: 'customer1@test.com', password: 'password123' };
export const CUSTOMER2 = { email: 'customer2@test.com', password: 'password123' };

/**
 * The scenario store config the harness seeded the database from and booted
 * the API under (plan E1.4): `STORE_CONFIG_FIXTURE`, demo unless the shell
 * picked another. Every money, locale and address assertion derives from it.
 */
export const STORE_CONFIG: StoreConfigFixture =
  harnessStoreConfigFixture() ?? loadStoreConfigFixture(DEFAULT_STORE_CONFIG_FIXTURE);

/** The currency the seed wrote on every order and gift card. */
export const STORE_CURRENCY = STORE_CONFIG.money.currencyCode;

/** The `localization.currencyConfig` row the seed wrote for the store currency. */
export const STORE_CURRENCY_CONFIG = {
  code: STORE_CONFIG.money.currencyCode,
  symbol: STORE_CONFIG.money.symbol,
  decimalPlaces: STORE_CONFIG.money.displayPrecision,
};

/** The locale every Translatable and redirect falls back to when the request names none the store enables. */
export const STORE_DEFAULT_LOCALE = STORE_CONFIG.localization.defaultLocale;

/** A well-formed language code no registry entry carries, so no store can enable it. */
export const UNKNOWN_LOCALE = 'zz';

/**
 * A locale the store has NOT enabled, for the specs that probe the refusal and
 * fallback paths. A registry locale the fixture leaves out when there is one;
 * when the fixture enables every registry locale, an unknown code instead.
 */
export const DISABLED_LOCALE =
  registryLocaleCodes().find(
    (locale) => !(STORE_CONFIG.localization.supportedLocales as readonly string[]).includes(locale),
  ) ?? UNKNOWN_LOCALE;

/**
 * A locale the store DOES ship, other than its default (demo: fr, since the
 * default is ar). Used by specs that round-trip an explicit non-default
 * `Accept-Language` and need it to actually be accepted, not just proving the
 * default-fallback path. Falls back to the default for a one-locale store.
 */
export const STORE_SECONDARY_LOCALE =
  (STORE_CONFIG.localization.supportedLocales as readonly string[]).find(
    (locale) => locale !== STORE_DEFAULT_LOCALE,
  ) ?? STORE_DEFAULT_LOCALE;

/**
 * A catalogue currency that is NOT the store's, for the specs that switch the
 * store currency and switch it back. Symbol and precision are the catalogue's.
 */
export const OTHER_CURRENCY_CONFIG =
  STORE_CURRENCY === 'AED'
    ? { code: 'KWD', symbol: 'د.ك', decimalPlaces: 3 }
    : { code: 'AED', symbol: 'د.إ', decimalPlaces: 2 };

/**
 * Inline shipping address inside the store's own market.
 *
 * The country comes from the active fixture on purpose: this single fixture
 * is imported by every ordering spec and the country is the argument that
 * resolves both the shipping zone and the tax zone, so a stale one silently
 * tests the wrong rate everywhere at once.
 */
export const STORE_ADDRESS = {
  fullName: 'E2E Tester',
  phone: STORE_CONFIG.identity.contact.phone,
  addressLine1: '12 Sample Street',
  city: STORE_CONFIG.identity.address.locality,
  ...(STORE_CONFIG.identity.address.postalCode
    ? { postalCode: STORE_CONFIG.identity.address.postalCode }
    : {}),
  country: STORE_CONFIG.identity.address.country,
};

/**
 * A shipping method that is actually valid for the destination the e2e specs
 * order to.
 *
 * Three specs took `GET /v1/admin/shipping/methods` and used `data[0].id`. That
 * list is ordered by `sortOrder` across every zone, so the first row is
 * whichever method happens to sort first, which is not necessarily one that
 * serves the store country. It resolved to a retired single-country method, and order creation
 * correctly rejected it with `SHIPPING_METHOD_INVALID`, failing 42 tests across
 * six suites: the order never got created, so everything downstream of it went
 * red too.
 *
 * In isolation each spec passed, because the E2E zones other suites create for
 * `{QA, SA}` were not there yet. That is what made it look like a flake rather
 * than the deterministic ordering bug it is.
 *
 * The methods list carries `zone: { id, name }` but not `countries`, so the
 * zone that serves the country is resolved first and the methods are then
 * queried by `zoneId`. Real API calls throughout, no fixtures.
 */
export async function shippingMethodForCountry(
  adminCookie: string,
  country: string,
): Promise<string> {
  const zonesRes = await api()
    .get('/v1/admin/shipping/zones')
    .set('Cookie', adminCookie)
    .expect(200);

  const zones = zonesRes.body.data as Array<{
    id: string;
    countries: string[];
    isActive: boolean;
  }>;
  const zone = zones.find((z) => z.isActive && z.countries?.includes(country));
  if (!zone) {
    throw new Error(
      `[shippingMethodForCountry] no active shipping zone serves ${country}. ` +
        `Zones seen: ${zones.map((z) => `${z.id}:[${z.countries?.join(',')}]`).join(' ')}`,
    );
  }

  const methodsRes = await api()
    .get('/v1/admin/shipping/methods')
    .query({ zoneId: zone.id })
    .set('Cookie', adminCookie)
    .expect(200);

  const method = (methodsRes.body.data as Array<{ id: string; isActive: boolean }>).find(
    (m) => m.isActive,
  );
  if (!method) {
    throw new Error(
      `[shippingMethodForCountry] zone ${zone.id} serves ${country} but has no active method`,
    );
  }
  return method.id;
}
