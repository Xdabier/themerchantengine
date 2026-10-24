import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  DISABLED_LOCALE,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';
import { E2E_BETTER_AUTH_SECRET } from '../../../test/e2e/env';
import {
  signNewsletterConfirmToken,
  signSubscriberUnsubscribeToken,
} from '../src/modules/campaigns/newsletter-token.util';

const SUFFIX = '@e2e-newsletter.test';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Newsletter double opt-in (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    // Subscriber.email is unique across soft-deleted rows too, so a crashed
    // prior run would make every direct create below throw.
    await prisma.campaignSend.deleteMany({ where: { recipient: { contains: SUFFIX } } });
    await prisma.subscriber.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.notificationLog.deleteMany({ where: { recipient: { contains: SUFFIX } } });
  });

  /**
   * The `newsletter.confirm` audit row written by `MailService.enqueue`. The
   * enqueue is awaited inside the request, so the row already exists when the
   * 202 lands; the short poll only absorbs connection lag.
   */
  async function confirmLogMetadata(email: string): Promise<Record<string, unknown> | null> {
    for (let i = 0; i < 20; i++) {
      const row = await prisma.notificationLog.findFirst({
        where: { templateCode: 'newsletter.confirm', recipient: email },
        orderBy: { sentAt: 'desc' },
        select: { metadata: true },
      });
      if (row) return (row.metadata ?? {}) as Record<string, unknown>;
      await sleep(150);
    }
    return null;
  }

  /** A confirmed subscriber plus the signed token its footer link would carry. */
  async function confirmedSubscriberWithToken(
    email: string,
  ): Promise<{ id: string; token: string }> {
    const row = await prisma.subscriber.create({
      data: { email, locale: 'fr', source: 'import', confirmedAt: new Date() },
    });
    return { id: row.id, token: signSubscriberUnsubscribeToken(row.id, E2E_BETTER_AUTH_SECRET) };
  }

  afterAll(async () => {
    await prisma.campaignSend.deleteMany({ where: { recipient: { contains: SUFFIX } } });
    await prisma.subscriber.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.notificationLog.deleteMany({ where: { recipient: { contains: SUFFIX } } });
    await prisma.$disconnect();
  });

  it('POST /v1/newsletter/subscribe creates an UNCONFIRMED subscriber (202)', async () => {
    const email = `signup${SUFFIX}`;
    const res = await api().post('/v1/newsletter/subscribe').send({ email, locale: 'en' });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ status: 'ok' }); // global interceptor wraps in { data }

    const row = await prisma.subscriber.findUnique({ where: { email } });
    expect(row).toBeTruthy();
    expect(row?.confirmedAt).toBeNull();
    expect(row?.source).toBe('newsletter-footer');
  });

  it('is idempotent — a second subscribe does not create a duplicate', async () => {
    const email = `dupe${SUFFIX}`;
    await api().post('/v1/newsletter/subscribe').send({ email });
    await api().post('/v1/newsletter/subscribe').send({ email });
    const count = await prisma.subscriber.count({ where: { email } });
    expect(count).toBe(1);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await api().post('/v1/newsletter/subscribe').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a locale the store has not enabled with 400 and creates no row', async () => {
    const email = `badlocale${SUFFIX}`;
    const res = await api()
      .post('/v1/newsletter/subscribe')
      .send({ email, locale: DISABLED_LOCALE });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(await prisma.subscriber.findUnique({ where: { email } })).toBeNull();
  });

  it('defaults the subscriber locale to the store default when the body omits it', async () => {
    const email = `nolocale${SUFFIX}`;
    const res = await api().post('/v1/newsletter/subscribe').send({ email });
    expect(res.status).toBe(202);
    const row = await prisma.subscriber.findUnique({ where: { email } });
    expect(row?.locale).toBe(STORE_DEFAULT_LOCALE);
  });

  it('rejects a request that trips the honeypot (400 BOT_DETECTED, no row)', async () => {
    const email = `honeypot${SUFFIX}`;
    const res = await api()
      .post('/v1/newsletter/subscribe')
      .set('x-hp-field', 'i-am-a-bot')
      .send({ email, locale: 'en' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('BOT_DETECTED');
    // The honeypot is always-on (independent of TURNSTILE_SECRET); no subscriber
    // row is created.
    const row = await prisma.subscriber.findUnique({ where: { email } });
    expect(row).toBeNull();
  });

  it('allows a normal request with an empty honeypot header (202)', async () => {
    const email = `hp-empty${SUFFIX}`;
    const res = await api()
      .post('/v1/newsletter/subscribe')
      .set('x-hp-field', '')
      .send({ email, locale: 'en' });
    expect(res.status).toBe(202);
  });

  it('GET /v1/newsletter/confirm sets confirmedAt for a valid token (302)', async () => {
    const email = `confirm${SUFFIX}`;
    await api().post('/v1/newsletter/subscribe').send({ email, locale: STORE_SECONDARY_LOCALE });
    const row = await prisma.subscriber.findUnique({ where: { email } });
    const token = signNewsletterConfirmToken(row!.id, E2E_BETTER_AUTH_SECRET);

    const res = await api()
      .get(
        `/v1/newsletter/confirm?token=${encodeURIComponent(token)}&locale=${STORE_SECONDARY_LOCALE}`,
      )
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(
      `/${STORE_SECONDARY_LOCALE}/newsletter/confirm?status=confirmed`,
    );

    const after = await prisma.subscriber.findUnique({ where: { email } });
    expect(after?.confirmedAt).not.toBeNull();
  });

  it('GET /v1/newsletter/confirm with a tampered token redirects status=invalid', async () => {
    const res = await api()
      .get('/v1/newsletter/confirm?token=garbage.token&locale=en')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=invalid');
  });

  it('GET /v1/newsletter/confirm redirects under the store default when no locale param is given', async () => {
    const res = await api().get('/v1/newsletter/confirm?token=garbage.token').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(
      `/${STORE_DEFAULT_LOCALE}/newsletter/confirm?status=invalid`,
    );
  });

  it('POST /v1/newsletter/unsubscribe opts a subscriber out (one-click)', async () => {
    const email = `unsub${SUFFIX}`;
    await api().post('/v1/newsletter/subscribe').send({ email });
    const row = await prisma.subscriber.findUnique({ where: { email } });
    const token = signSubscriberUnsubscribeToken(row!.id, E2E_BETTER_AUTH_SECRET);

    const res = await api()
      .post(`/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ unsubscribed: true }); // global interceptor wraps in { data }

    const after = await prisma.subscriber.findUnique({ where: { email } });
    expect(after?.unsubscribedAt).not.toBeNull();
  });

  // ── GET /v1/newsletter/unsubscribe — the link a human clicks in the footer ──
  //
  // Only the RFC 8058 POST twin above was covered. The GET is the one customers
  // actually reach: it opts out AND redirects into the locale-prefixed
  // storefront, so the redirect target is part of the contract, not decoration.

  describe('GET /v1/newsletter/unsubscribe (footer link)', () => {
    it('opts the subscriber out and redirects under the link locale (302)', async () => {
      const email = `unsub-get-en${SUFFIX}`;
      const { id, token } = await confirmedSubscriberWithToken(email);

      const res = await api()
        .get(`/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}&locale=en`)
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/en/newsletter/confirm?status=unsubscribed');

      const after = await prisma.subscriber.findUnique({ where: { id } });
      expect(after?.unsubscribedAt).not.toBeNull();
    });

    it('redirects under the store default when the link carries no locale', async () => {
      const email = `unsub-get-default${SUFFIX}`;
      const { id, token } = await confirmedSubscriberWithToken(email);

      const res = await api()
        .get(`/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}`)
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(
        `/${STORE_DEFAULT_LOCALE}/newsletter/confirm?status=unsubscribed`,
      );

      const after = await prisma.subscriber.findUnique({ where: { id } });
      expect(after?.unsubscribedAt).not.toBeNull();
    });

    it('resolves a locale the storefront does not route to the store default', async () => {
      // A segment the store does not enable must not reach the redirect: it
      // would send the customer to a 404 instead of the preference page.
      const email = `unsub-get-unknown${SUFFIX}`;
      const { token } = await confirmedSubscriberWithToken(email);

      const res = await api()
        .get(
          `/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}&locale=${DISABLED_LOCALE}`,
        )
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(
        `/${STORE_DEFAULT_LOCALE}/newsletter/confirm?status=unsubscribed`,
      );
    });

    it('redirects to the invalid state for a tampered token and flips nothing', async () => {
      const email = `unsub-get-tampered${SUFFIX}`;
      const { id } = await confirmedSubscriberWithToken(email);

      const res = await api()
        .get(`/v1/newsletter/unsubscribe?token=garbage.token&locale=${STORE_SECONDARY_LOCALE}`)
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(
        `/${STORE_SECONDARY_LOCALE}/newsletter/confirm?status=invalid`,
      );

      const after = await prisma.subscriber.findUnique({ where: { id } });
      expect(after?.unsubscribedAt).toBeNull();
    });
  });

  // ── Double opt-in confirmation renders in the subscriber's own locale ───────
  //
  // The confirmation used to go out in English whatever the signup said. It now
  // rides `SubscribeDto.locale` through `resolveLocale`, and the enqueued locale
  // is observable on the `NotificationLog` row `MailService.enqueue` writes
  // before the queue add — plus on the dev-only `actionUrl`, which carries the
  // same locale forward into the confirm redirect.

  describe('confirmation email locale', () => {
    it('enqueues the confirmation in the store secondary locale for a matching signup', async () => {
      const email = `confirm-locale-secondary${SUFFIX}`;
      expect(
        (
          await api()
            .post('/v1/newsletter/subscribe')
            .send({ email, locale: STORE_SECONDARY_LOCALE })
        ).status,
      ).toBe(202);

      const metadata = await confirmLogMetadata(email);
      expect(metadata).not.toBeNull();
      expect(metadata!.locale).toBe(STORE_SECONDARY_LOCALE);
      expect(String(metadata!.actionUrl)).toContain(`locale=${STORE_SECONDARY_LOCALE}`);
    });

    it('enqueues the confirmation in en for an English signup', async () => {
      const email = `confirm-locale-en${SUFFIX}`;
      expect(
        (await api().post('/v1/newsletter/subscribe').send({ email, locale: 'en' })).status,
      ).toBe(202);

      const metadata = await confirmLogMetadata(email);
      expect(metadata).not.toBeNull();
      expect(metadata!.locale).toBe('en');
      expect(String(metadata!.actionUrl)).toContain('locale=en');
    });

    it('falls back to the store default when the signup omits a locale', async () => {
      const email = `confirm-locale-default${SUFFIX}`;
      expect((await api().post('/v1/newsletter/subscribe').send({ email })).status).toBe(202);

      const metadata = await confirmLogMetadata(email);
      expect(metadata).not.toBeNull();
      expect(metadata!.locale).toBe(STORE_DEFAULT_LOCALE);
    });

    it('the emailed confirm link round-trips to the storefront page in that locale', async () => {
      // End-to-end on the customer's path: sign up in en, follow the exact URL
      // the email carries, land on /en. Proves the locale survives the hop.
      const email = `confirm-roundtrip-en${SUFFIX}`;
      await api().post('/v1/newsletter/subscribe').send({ email, locale: 'en' });
      const metadata = await confirmLogMetadata(email);
      const actionUrl = new URL(String(metadata!.actionUrl));

      const res = await api().get(`${actionUrl.pathname}${actionUrl.search}`).redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/en/newsletter/confirm?status=confirmed');

      const after = await prisma.subscriber.findUnique({ where: { email } });
      expect(after?.confirmedAt).not.toBeNull();
    });
  });
});
