/**
 * Public analytics ingestion (plan I phase I7, finding D2).
 *
 * `POST /v1/analytics/events` has existed and been complete since the module
 * shipped, and nothing ever called it: the storefront emitted no analytics of
 * any kind, so every admin analytics dashboard read an empty table and the
 * server-side purchase forwarding never ran. This spec is the API half of
 * closing that, and it exists because no e2e covered the endpoint at all.
 *
 * Real dockerized DB per constitution §3.8. Rows are cleaned up by session id.
 */
import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma, STORE_SECONDARY_LOCALE } from './helpers';

const SESSION = `e2e-i7-${Date.now()}`;

const ACCEPTED = [
  'page_view',
  'product_view',
  'add_to_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'search',
] as const;

describe('POST /v1/analytics/events', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { sessionId: { startsWith: 'e2e-i7-' } } });
    await prisma.$disconnect();
  });

  it.each(ACCEPTED)('accepts %s from an anonymous visitor', async (eventType) => {
    await api()
      .post('/v1/analytics/events')
      .send({ eventType, sessionId: `${SESSION}-${eventType}`, locale: STORE_SECONDARY_LOCALE })
      .expect(204);
  });

  it('persists the row the admin dashboards read', async () => {
    const sessionId = `${SESSION}-persist`;
    await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'product_view', sessionId, locale: 'en', data: { source: 'e2e' } })
      .expect(204);

    const row = await prisma.analyticsEvent.findFirst({ where: { sessionId } });
    expect(row).not.toBeNull();
    expect(row?.eventType).toBe('product_view');
    expect(row?.locale).toBe('en');
  });

  it('rejects an event type outside the enum', async () => {
    await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'definitely_not_a_step', sessionId: `${SESSION}-bad` })
      .expect(400);
  });

  it('rejects a locale the storefront cannot emit', async () => {
    await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'page_view', sessionId: `${SESSION}-loc`, locale: 'de' })
      .expect(400);
  });

  it('rejects a session id outside the safe character set', async () => {
    // The value is written to a column the admin dashboards group by; the
    // pattern is what keeps it a plain identifier.
    await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'page_view', sessionId: 'not a session id' })
      .expect(400);
  });

  it('strips a key the DTO does not declare instead of storing it', async () => {
    // The global pipe runs whitelist + forbidNonWhitelisted, so an unexpected
    // key is a 400 rather than an untyped blob landing in the events table.
    await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'page_view', sessionId: `${SESSION}-extra`, rogueField: 'nope' })
      .expect(400);
  });
});
