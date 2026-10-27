/**
 * Anonymous cart merge on sign-in (plan F phase F2, finding K4 / pass-2 A9).
 *
 * `CartService.mergeAnonymousCart` was implemented and unit-tested when the
 * cart module was built, then the Better Auth cutover deleted the custom login
 * controller that was its only caller. Nothing re-wired it, so signing in threw
 * the guest basket away and the unit suite stayed green the whole time. This
 * spec pins the endpoint that gives it a caller again.
 *
 * Real dockerized DB per constitution §3.8, real cookies, no mocks.
 */
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, API_BASE_URL, createTestPrisma, extractCookie, signUpCustomer } from './helpers';

const PASSWORD = 'Atlas-Test-123!';

interface CartBody {
  id: string;
  itemCount: number;
  couponCode: string | null;
  items: { variantId: string }[];
}

function cartOf(res: request.Response): CartBody {
  return (res.body.data ?? res.body) as CartBody;
}

describe('POST /v1/cart/merge', () => {
  let prisma: PrismaClient;
  let variantIds: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    // Candidates come from the database because the storefront product LIST
    // does not carry variants; only the detail endpoint does. Ordered by stock
    // so the first attempt is the one most likely to be accepted.
    const rows = await prisma.productVariant.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        product: { status: 'ACTIVE', deletedAt: null },
        stockLevels: { some: { onHand: { gt: 5 } } },
      },
      select: { id: true },
      take: 10,
    });
    variantIds = rows.map((r) => r.id);
    // Jest's `expect` takes no message argument, unlike Playwright's.
    if (variantIds.length === 0) {
      throw new Error('seeded catalogue must expose an in-stock variant');
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * A brand-new customer, returning their Better Auth session-cookie header.
   *
   * Uses the shared helper rather than a hand-rolled sign-up: it flushes the
   * shared sign-in rate-limit budget first, marks the address verified, and
   * signs in for the session cookie. The raw sign-up response carries no
   * session cookie of its own.
   */
  async function signUp(): Promise<string> {
    const email = `f2-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
    return signUpCustomer(prisma, email, PASSWORD, { firstName: 'F2', lastName: 'Probe' });
  }

  /**
   * An anonymous cart holding one line, returning its `sessionId` cookie and
   * the variant that went in.
   *
   * Tries candidates until an add is accepted rather than asserting on the
   * first one. Which seeded product is short of stock moves with every e2e run
   * that places an order, and a spec about merging carts should not fail
   * because it picked that product.
   */
  /**
   * One addable variant, resolved once.
   *
   * `POST /v1/cart/items` is `@RateLimit.StorefrontWrite()` — 30 requests a
   * minute — and the backend e2e runs with throttling ON. Probing ten variants
   * on every call burned that budget within a couple of tests, and the refusals
   * then read as "nothing is in stock", which is a much more alarming diagnosis
   * than the true one.
   */
  let addableVariantId: string | null = null;

  async function resolveAddableVariant(): Promise<string> {
    if (addableVariantId) return addableVariantId;
    for (const variantId of variantIds) {
      const res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 });
      if ([200, 201].includes(res.status)) {
        addableVariantId = variantId;
        return variantId;
      }
    }
    throw new Error('no seeded variant could be added to an anonymous cart');
  }

  /** One add, with a single retry when the shared write budget is exhausted. */
  async function addOnce(variantId: string) {
    let res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 });
    }
    return res;
  }

  async function guestCartCookie(): Promise<{ cookie: string; variantId: string }> {
    const variantId = await resolveAddableVariant();
    const res = await addOnce(variantId);
    if (![200, 201].includes(res.status)) {
      throw new Error(`anonymous add failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const sessionId = extractCookie(res, 'sessionId');
    if (!sessionId) throw new Error('anonymous add must mint the sessionId cookie');
    return { cookie: `sessionId=${sessionId}`, variantId };
  }

  it('folds the guest line into the account cart', async () => {
    const { cookie: guest, variantId } = await guestCartCookie();
    const auth = await signUp();

    const merged = await api()
      .post('/v1/cart/merge')
      .set('Cookie', `${auth}; ${guest}`)
      .expect(200);
    expect(cartOf(merged).itemCount).toBe(1);

    // Read back as the customer alone. Without the merge this is 0, which is
    // the A9 symptom verbatim; with the guest cookie still attached the guest
    // cart would answer instead and hide the defect.
    const after = await api().get('/v1/cart').set('Cookie', auth).expect(200);
    expect(cartOf(after).itemCount).toBe(1);
    expect(cartOf(after).items[0].variantId).toBe(variantId);
  });

  it('clears the anonymous cookie once the cart has been claimed', async () => {
    const { cookie: guest } = await guestCartCookie();
    const auth = await signUp();

    const merged = await api()
      .post('/v1/cart/merge')
      .set('Cookie', `${auth}; ${guest}`)
      .expect(200);
    const setCookie = merged.headers['set-cookie'] as unknown as string[] | undefined;
    const raw = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).join('|');
    expect(raw).toMatch(/sessionId=;|sessionId=""/);
  });

  it('is a no-op with no anonymous cookie', async () => {
    const auth = await signUp();
    const res = await api().post('/v1/cart/merge').set('Cookie', auth).expect(200);
    expect(cartOf(res).itemCount).toBe(0);
  });

  it('is idempotent — replaying the merge does not duplicate the line', async () => {
    const { cookie: guest } = await guestCartCookie();
    const auth = await signUp();
    const cookie = `${auth}; ${guest}`;

    await api().post('/v1/cart/merge').set('Cookie', cookie).expect(200);
    const second = await api().post('/v1/cart/merge').set('Cookie', cookie).expect(200);
    expect(cartOf(second).itemCount).toBe(1);
  });

  it('survives concurrent calls, which the shell boot can produce', async () => {
    // The merge runs at Serializable isolation, so Postgres aborts one side of
    // a conflict with a write-conflict error. That surfaced as a 500 on roughly
    // one storefront sign-in in twelve until the service started retrying.
    const { cookie: guest } = await guestCartCookie();
    const auth = await signUp();
    const cookie = `${auth}; ${guest}`;

    const results = await Promise.all([
      request(API_BASE_URL).post('/v1/cart/merge').set('Cookie', cookie),
      request(API_BASE_URL).post('/v1/cart/merge').set('Cookie', cookie),
      request(API_BASE_URL).get('/v1/cart').set('Cookie', cookie),
    ]);
    for (const res of results) expect(res.status).toBe(200);

    const after = await api().get('/v1/cart').set('Cookie', auth).expect(200);
    expect(cartOf(after).itemCount).toBe(1);
  });

  it('refuses an anonymous caller', async () => {
    const { cookie: guest } = await guestCartCookie();
    const res = await api().post('/v1/cart/merge').set('Cookie', guest);
    expect(res.status).toBe(401);
  });
});
