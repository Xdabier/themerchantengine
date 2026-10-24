import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  signUpCustomer,
  DISABLED_LOCALE,
  STORE_CURRENCY,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-gift-cards.test';
const TEST_PASSWORD = 'StrongPass1';
const E2E_CODE_PREFIX = 'E2EGC';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Gift Cards (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let customerCookie: string;
  let customer2Cookie: string;

  let issuedCardId: string;
  let issuedCardCode: string;
  let storeCreditCardId: string;
  let storeCreditCode: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Cleanup previous runs ─────────────────────────────────────────────────
    await prisma.giftCardTransaction.deleteMany({
      where: { giftCard: { code: { startsWith: E2E_CODE_PREFIX } } },
    });
    await prisma.giftCard.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'e2e-role-' } } });

    // ── Create admin user with the gift-cards permission set ──────────────────
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['gift_cards:view', 'gift_cards:create', 'gift_cards:update'],
      firstName: 'GiftCards',
      lastName: 'Admin',
    });
    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);

    // ── Customer sessions ─────────────────────────────────────────────────────
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'GiftCards',
      lastName: 'Customer',
    });
    customer2Cookie = await signUpCustomer(prisma, `customer2${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'GiftCards',
      lastName: 'CustomerTwo',
    });
  });

  afterAll(async () => {
    await prisma.giftCardTransaction.deleteMany({
      where: { giftCard: { code: { startsWith: E2E_CODE_PREFIX } } },
    });
    await prisma.giftCard.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'e2e-role-' } } });
    await prisma.$disconnect();
  });

  // ── 1. Admin: issue gift card ──────────────────────────────────────────────

  it('POST /v1/admin/gift-cards — issues gift card with custom code (201)', async () => {
    const customCode = `${E2E_CODE_PREFIX}GIFT00000001`;

    const res = await api().post('/v1/admin/gift-cards').set('Cookie', adminCookie).send({
      code: customCode,
      initialBalance: 200,
      currency: STORE_CURRENCY,
      recipientEmail: 'recipient@e2e.test',
      recipientName: 'E2E Recipient',
      isActive: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe(customCode);
    expect(Number(res.body.data.initialBalance)).toBeCloseTo(200);
    expect(Number(res.body.data.currentBalance)).toBeCloseTo(200);

    issuedCardId = res.body.data.id as string;
    issuedCardCode = res.body.data.code as string;
  });

  it('POST /v1/admin/gift-cards — issues store credit (purchasedBy omitted) (201)', async () => {
    const creditCode = `${E2E_CODE_PREFIX}CREDIT000001`;

    const res = await api().post('/v1/admin/gift-cards').set('Cookie', adminCookie).send({
      code: creditCode,
      initialBalance: 50,
      currency: STORE_CURRENCY,
      recipientEmail: 'customer@e2e.test',
      isActive: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.purchasedBy).toBeNull();

    storeCreditCardId = res.body.data.id as string;
    storeCreditCode = res.body.data.code as string;
  });

  it('POST /v1/admin/gift-cards — rejects duplicate code (400)', async () => {
    const res = await api().post('/v1/admin/gift-cards').set('Cookie', adminCookie).send({
      code: issuedCardCode,
      initialBalance: 100,
      currency: STORE_CURRENCY,
    });

    expect(res.status).toBe(400);
  });

  // The admin issue form used to default to USD and really created USD cards in
  // a single-currency store. The server is the last line of defence.
  it('POST /v1/admin/gift-cards — rejects a currency outside the enabled set (400)', async () => {
    const res = await api()
      .post('/v1/admin/gift-cards')
      .set('Cookie', adminCookie)
      .send({
        code: `${E2E_CODE_PREFIX}${randomUUID().slice(0, 8).toUpperCase()}`,
        initialBalance: 100,
        currency: 'USD',
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('GIFT_CARD_CURRENCY_NOT_ENABLED');
  });

  // ── 2. Admin: list gift cards ──────────────────────────────────────────────

  it('GET /v1/admin/gift-cards — returns paginated list (200)', async () => {
    const res = await api().get('/v1/admin/gift-cards').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('GET /v1/admin/gift-cards?isActive=true — filters active cards', async () => {
    const res = await api().get('/v1/admin/gift-cards?isActive=true').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const cards = res.body.data as Array<{ isActive: boolean }>;
    expect(cards.every((c) => c.isActive)).toBe(true);
  });

  // ── 3. Admin: detail view ─────────────────────────────────────────────────

  it('GET /v1/admin/gift-cards/:id — returns card with transaction log (200)', async () => {
    const res = await api().get(`/v1/admin/gift-cards/${issuedCardId}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(issuedCardId);
    expect(res.body.data.transactions).toBeDefined();
    expect(res.body.data.transactions.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/admin/gift-cards/:id — 404 for unknown id', async () => {
    const res = await api().get('/v1/admin/gift-cards/nonexistent-id').set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  // ── 4. Storefront: balance check (public) ─────────────────────────────────

  it('GET /v1/gift-cards/balance?code=XXX — returns balance for valid card (200)', async () => {
    const res = await api().get(`/v1/gift-cards/balance?code=${issuedCardCode}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.data.currentBalance)).toBeCloseTo(200);
    expect(res.body.data.currency).toBe(STORE_CURRENCY);
  });

  it('GET /v1/gift-cards/balance — 400 for unknown code (generic error)', async () => {
    const res = await api().get('/v1/gift-cards/balance?code=DOESNOTEXIST1234');

    expect(res.status).toBe(400);
    // Must NOT reveal whether the code exists or is expired
    expect(res.body.error?.message).not.toMatch(/not found/i);
  });

  it('GET /v1/gift-cards/balance — 400 when code is missing', async () => {
    const res = await api().get('/v1/gift-cards/balance');

    expect(res.status).toBe(400);
  });

  // ── 5. Storefront: the mint is closed (DR-30) ──────────────────────────────

  it('POST /v1/gift-cards/purchase mints nothing, for anyone, ever', async () => {
    // This route used to answer 201 with a card worth whatever the body asked
    // for, no payment captured, no order attached. The assertion is on the
    // database as well as on the status, because a route that answered 404
    // while still writing a row would satisfy a status-only check.
    const before = await prisma.giftCard.count();

    const authed = await api()
      .post('/v1/gift-cards/purchase')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({ initialBalance: 1000000, currency: STORE_CURRENCY });
    expect(authed.status).toBe(404);

    const anon = await api()
      .post('/v1/gift-cards/purchase')
      .set('X-Idempotency-Key', randomUUID())
      .send({ initialBalance: 1000000, currency: STORE_CURRENCY });
    expect(anon.status).toBe(404);

    expect(await prisma.giftCard.count()).toBe(before);
  });

  it('and the admin issuance route still works, so the check above is not vacuous', async () => {
    // A 404 on every POST would satisfy the test above for the wrong reason.
    const res = await api()
      .post('/v1/admin/gift-cards')
      .set('Cookie', adminCookie)
      .send({ initialBalance: 25, currency: STORE_CURRENCY });

    expect(res.status).toBe(201);
    const created = res.body.data.code as string;
    await prisma.giftCardTransaction.deleteMany({ where: { giftCard: { code: created } } });
    await prisma.giftCard.deleteMany({ where: { code: created } });
  });

  // The idempotency-pipe contract used to be exercised through the purchase
  // route. It is covered without it: orders covers REQUIRED, MALFORMED,
  // FORBIDDEN and CONFLICT; inventory, returns and webhooks each cover
  // REQUIRED and MALFORMED on their own sensitive writes.

  it('PATCH /v1/admin/gift-cards/:id — deactivates card (200)', async () => {
    const res = await api()
      .patch(`/v1/admin/gift-cards/${storeCreditCardId}`)
      .set('Cookie', adminCookie)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('GET /v1/gift-cards/balance — 400 for deactivated card (generic error)', async () => {
    const res = await api().get(`/v1/gift-cards/balance?code=${storeCreditCode}`);

    expect(res.status).toBe(400);
  });

  // ── 7. Auth guards ─────────────────────────────────────────────────────────

  it('GET /v1/admin/gift-cards — 401 without token', async () => {
    const res = await api().get('/v1/admin/gift-cards');
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/gift-cards — 401 without token', async () => {
    const res = await api()
      .post('/v1/admin/gift-cards')
      .send({ initialBalance: 100, currency: STORE_CURRENCY });
    expect(res.status).toBe(401);
  });

  it('PATCH /v1/admin/gift-cards/:id — 401 without token', async () => {
    const res = await api().patch(`/v1/admin/gift-cards/${issuedCardId}`).send({ isActive: false });
    expect(res.status).toBe(401);
  });

  // ── 8. Translatable round-trip on personalMessage (D2) ─────────────────────
  //
  // D2 changed the seven `dto/translatable.dto.ts` copies from declaring `ar?`
  // to declaring `fr?`. The global ValidationPipe runs with `whitelist: true`
  // and `forbidNonWhitelisted: true`, so before that change an `fr` key was
  // rejected with 400 on every admin write and an `ar` key sailed through.
  // Six of the seven modules already pin the new shape end-to-end; gift-cards
  // was the one with no coverage. `personalMessage` is the field wired to
  // TranslatableDto here, on both `create-gift-card.dto.ts` and
  // `purchase-gift-card.dto.ts`.
  //
  // `default` deliberately differs from both `fr` and `en`, so the resolved
  // value names which rung of the fallback chain answered. An assertion where
  // `default` and `fr` carry the same string would pass through the `default`
  // rung and prove nothing about the `fr` key.

  describe('personalMessage Translatable round-trip (D2)', () => {
    // Keyed by the store's own enabled locale pair (default + secondary), not
    // a literal fr/en: gulf-rtl ships ar/en and would 400 a submitted 'fr' key
    // (IsEnabledLocale, plan E1.3.4).
    const MESSAGE = {
      default: 'Message default',
      [STORE_DEFAULT_LOCALE]: 'Happy birthday default-locale',
      [STORE_SECONDARY_LOCALE]: 'Happy birthday secondary-locale',
    };
    const MATRIX_CODE = `${E2E_CODE_PREFIX}TRANSLAT0001`;
    let matrixCardId: string;

    it('POST /v1/admin/gift-cards: accepts a personalMessage carrying the store secondary-locale key (201)', async () => {
      const res = await api().post('/v1/admin/gift-cards').set('Cookie', adminCookie).send({
        code: MATRIX_CODE,
        initialBalance: 75,
        currency: STORE_CURRENCY,
        recipientEmail: 'fr-recipient@e2e.test',
        personalMessage: MESSAGE,
      });

      expect(res.status).toBe(201);
      matrixCardId = res.body.data.id as string;

      // The write reached the database with every key intact.
      const row = await prisma.giftCard.findUnique({ where: { id: matrixCardId } });
      expect(row?.personalMessage).toEqual(MESSAGE);
    });

    it('POST /v1/admin/gift-cards: rejects a personalMessage keyed by a locale the store has not enabled (400)', async () => {
      const res = await api()
        .post('/v1/admin/gift-cards')
        .set('Cookie', adminCookie)
        .send({
          code: `${E2E_CODE_PREFIX}TRANSLAT0002`,
          initialBalance: 75,
          currency: STORE_CURRENCY,
          personalMessage: { default: 'Message par defaut', [DISABLED_LOCALE]: 'Hors catalogue' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
      const row = await prisma.giftCard.findUnique({
        where: { code: `${E2E_CODE_PREFIX}TRANSLAT0002` },
      });
      expect(row).toBeNull();
    });

    it('GET /v1/admin/gift-cards/:id returns the raw Translatable under X-Resolve-Locale: false', async () => {
      const res = await api()
        .get(`/v1/admin/gift-cards/${matrixCardId}`)
        .set('Cookie', adminCookie)
        .set('X-Resolve-Locale', 'false');

      expect(res.status).toBe(200);
      expect(res.body.data.personalMessage).toEqual(MESSAGE);
    });

    it('GET /v1/admin/gift-cards/:id resolves personalMessage to the secondary locale under its Accept-Language', async () => {
      const res = await api()
        .get(`/v1/admin/gift-cards/${matrixCardId}`)
        .set('Cookie', adminCookie)
        .set('Accept-Language', STORE_SECONDARY_LOCALE);

      expect(res.status).toBe(200);
      // Only the secondary-locale key carries this string, so the value pins that rung.
      expect(res.body.data.personalMessage).toBe('Happy birthday secondary-locale');
    });

    it('GET /v1/admin/gift-cards/:id resolves personalMessage to the default locale under its Accept-Language', async () => {
      const res = await api()
        .get(`/v1/admin/gift-cards/${matrixCardId}`)
        .set('Cookie', adminCookie)
        .set('Accept-Language', STORE_DEFAULT_LOCALE);

      expect(res.status).toBe(200);
      expect(res.body.data.personalMessage).toBe('Happy birthday default-locale');
    });

    // The customer-facing purchase round-trip is gone with the route (DR-30).
    // The Translatable contract it exercised is the same one the admin create
    // above covers, and that write is the only one that still exists.
  });
});
