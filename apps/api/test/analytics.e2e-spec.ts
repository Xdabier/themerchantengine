import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  DISABLED_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// Public analytics ingestion: locale allowlist (D2, extended at plan E1.3.4)
// ═══════════════════════════════════════════════════════════════════════════════
//
// `POST /v1/analytics/events` is public, unauthenticated and rate-limited, and
// it was the last storefront-facing write with no e2e coverage of any kind.
//
// At D2 `IngestEventDto.locale` moved from a shape-only `@Matches(/^[a-z]{2}
// (-[A-Z]{2})?$/)` to an `@IsIn(LOCALE_CATALOGUE)` allowlist. Plan E1.3.4 then
// added `@IsEnabledLocaleValue()` on top, so a well-formed catalogue locale the
// STORE has not enabled is also rejected, not just a malformed one. The unit
// spec cannot see either gate: `analytics.service.spec.ts` hands the service an
// already-validated object and never runs class-validator. Only a request
// through the global ValidationPipe proves the allowlist is wired.
//
// Mirrors `newsletter.e2e-spec.ts`, which pins the sibling `@IsEnabledLocaleValue()`
// on the subscriber DTO.

const SESSION_PREFIX = 'e2e-analytics-';

describe('Analytics ingestion (e2e)', () => {
  let prisma: PrismaClient;

  /** Unique per case so "did a row land?" is answerable without cross-talk. */
  const sessionId = (name: string): string => `${SESSION_PREFIX}${name}-${Date.now()}`;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({
      where: { sessionId: { startsWith: SESSION_PREFIX } },
    });
    await prisma.$disconnect();
  });

  // ── Accepted locales ───────────────────────────────────────────────────────

  it('accepts the store secondary locale and persists it (204)', async () => {
    const session = sessionId('secondary');
    const res = await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'product_view', sessionId: session, locale: STORE_SECONDARY_LOCALE });

    expect(res.status).toBe(204);

    const row = await prisma.analyticsEvent.findFirst({ where: { sessionId: session } });
    expect(row).toBeTruthy();
    expect(row?.locale).toBe(STORE_SECONDARY_LOCALE);
    expect(row?.eventType).toBe('product_view');
  });

  it('accepts locale=en and persists it (204)', async () => {
    const session = sessionId('en');
    const res = await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'add_to_cart', sessionId: session, locale: 'en' });

    expect(res.status).toBe(204);

    const row = await prisma.analyticsEvent.findFirst({ where: { sessionId: session } });
    expect(row).toBeTruthy();
    expect(row?.locale).toBe('en');
  });

  it('accepts a body with no locale at all, the field is optional (204)', async () => {
    const session = sessionId('nolocale');
    const res = await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'search', sessionId: session, data: { query: 'brosse' } });

    expect(res.status).toBe(204);

    const row = await prisma.analyticsEvent.findFirst({ where: { sessionId: session } });
    expect(row).toBeTruthy();
    // Optional means absent, not defaulted, so the service writes null.
    expect(row?.locale).toBeNull();
  });

  // ── Rejected locales ───────────────────────────────────────────────────────

  it('rejects an unsupported locale (de) with 400 and writes no row', async () => {
    const session = sessionId('de');
    const res = await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'product_view', sessionId: session, locale: 'de' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(await prisma.analyticsEvent.findFirst({ where: { sessionId: session } })).toBeNull();
  });

  it('rejects a catalogue locale the store has not enabled with 400 and writes no row', async () => {
    // `ar` is the case that matters: it is a well-formed two-letter code, so the
    // pre-D2 shape-only regex accepted it. Only a real allowlist rejects it, and
    // this store no longer serves Arabic.
    const session = sessionId('ar');
    const res = await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'product_view', sessionId: session, locale: DISABLED_LOCALE });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(await prisma.analyticsEvent.findFirst({ where: { sessionId: session } })).toBeNull();
  });

  it('rejects a region-suffixed code the old regex allowed (fr-FR) with 400', async () => {
    // The retired regex accepted an optional `-XX` region suffix. The allowlist
    // is the bare pair, so the suffixed form is out even for a supported
    // language. This pins the allowlist to exactly `fr` | `en`.
    const session = sessionId('frfr');
    const res = await api()
      .post('/v1/analytics/events')
      .send({ eventType: 'product_view', sessionId: session, locale: 'fr-FR' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(await prisma.analyticsEvent.findFirst({ where: { sessionId: session } })).toBeNull();
  });
});
