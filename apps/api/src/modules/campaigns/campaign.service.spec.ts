import {
  FR_EN_LOCALE_SET,
  NEUTRAL_LOCALE_SET,
  registerScratchLocale,
  storeLocales,
} from '@common/locale';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { MAIL_LOCALES } from '../mail/mail.types';
import { NEUTRAL_MONEY, storeMoney } from '@common/money';
import { loadStoreConfigFixture } from '@common/store-config-fixtures';

const SECRET = 'campaign-svc-test-secret-0123456789'; // gitleaks:allow

/** The composed `From:` header the configured identity below must produce. */
const EXPECTED_FROM = 'My Store <noreply@example.test>';

/** The store name the runtime config carries (DR-31). */
const STORE_NAME = 'Atlas Supplies';

/** The two invisible characters the store's money format is built from (DR-31). */
const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f);
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

/** Money is formatted from the process-wide snapshot: the maghreb-ltr scenario, LYD at three decimals. */
beforeAll(() => storeMoney.set(loadStoreConfigFixture('maghreb-ltr').money));
afterAll(() => storeMoney.set(NEUTRAL_MONEY));

function makeSettings() {
  return {
    get: jest.fn(async (key: string) =>
      key === 'storeName' ? { default: STORE_NAME, fr: STORE_NAME, en: STORE_NAME } : undefined,
    ),
  };
}

function makePrisma() {
  return {
    campaign: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    campaignSend: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn(),
    },
    promotion: { findFirst: jest.fn() },
    subscriber: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
}

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    UNSUBSCRIBE_TOKEN_SECRET: SECRET,
    API_PUBLIC_BASE_URL: 'https://api.example.test',
    STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test',
    RESEND_FROM_EMAIL: 'noreply@example.test',
    RESEND_FROM_NAME: 'My Store',
    RESEND_REPLY_TO: 'contact@example.test',
    ...overrides,
  };
  return { get: jest.fn((k: string, d?: string) => values[k] ?? d) };
}

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('CampaignService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let config: ReturnType<typeof makeConfig>;
  let resend: { send: jest.Mock; sendBatch: jest.Mock };
  let suppression: { isSuppressed: jest.Mock };
  let preferences: { buildUnsubscribeUrl: jest.Mock };
  let queue: { add: jest.Mock };
  let settings: ReturnType<typeof makeSettings>;
  let service: CampaignService;

  beforeEach(() => {
    prisma = makePrisma();
    config = makeConfig();
    resend = {
      send: jest.fn().mockResolvedValue({ id: 'm', dryRun: true }),
      sendBatch: jest
        .fn()
        .mockImplementation((items: unknown[]) =>
          Promise.resolve({ ids: items.map((_, i) => `m${i}`), dryRun: true }),
        ),
    };
    suppression = { isSuppressed: jest.fn().mockResolvedValue(false) };
    preferences = {
      buildUnsubscribeUrl: jest
        .fn()
        .mockReturnValue('https://api.example.test/v1/unsubscribe?token=t'),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    settings = makeSettings();
    service = new CampaignService(
      prisma as never,
      config as never,
      resend as never,
      suppression as never,
      preferences as never,
      queue as never,
      settings as never,
    );
  });

  describe('validateCoupon', () => {
    it('throws CAMPAIGN_INVALID_COUPON when no active promotion matches', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);
      await expect(service.validateCoupon('NOPE')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns the promotion type+value when active', async () => {
      prisma.promotion.findFirst.mockResolvedValue({ type: 'PERCENTAGE', value: 15 });
      await expect(service.validateCoupon('SAVE15')).resolves.toEqual({
        type: 'PERCENTAGE',
        value: 15,
      });
    });
  });

  describe('create', () => {
    it('validates an attached coupon before persisting', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { name: 'c', subject: {}, body: {}, segment: 'ALL_CONFIRMED', couponCode: 'BAD' },
          'admin1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('persists a DRAFT broadcast campaign', async () => {
      prisma.campaign.create.mockResolvedValue({ id: 'camp1' });
      await service.create(
        { name: 'c', subject: { en: 's' }, body: { en: 'b' }, segment: 'ALL_CONFIRMED' },
        'admin1',
      );
      const data = prisma.campaign.create.mock.calls[0][0].data;
      expect(data.status).toBe('DRAFT');
      expect(data.kind).toBe('BROADCAST');
      expect(data.createdById).toBe('admin1');
    });
  });

  /**
   * Constitution 3.5 requires the scrub on operator-authored rich text, and a
   * campaign reaches the entire subscriber list rather than one flow's
   * recipients. The sibling notification path has scrubbed since NE6; this one
   * wrote the body verbatim until the D7 security review, so these are the
   * tests that make a revert of that fix visible instead of silent.
   */
  describe('sanitize-on-write', () => {
    const HOSTILE = {
      fr: '<p>Bonjour</p><script>alert(1)</script>',
      en: '<p>Hello</p><a href="javascript:alert(1)" onclick="steal()">tap</a>',
    };

    it('strips script and event handlers before the create write', async () => {
      prisma.campaign.create.mockResolvedValue({ id: 'camp1' });
      await service.create(
        { name: 'c', subject: { fr: 'S', en: 'S' }, body: HOSTILE, segment: 'ALL_CONFIRMED' },
        'admin1',
      );
      const data = prisma.campaign.create.mock.calls[0][0].data;
      expect(data.body.fr).toBe('<p>Bonjour</p>');
      expect(data.body.en).not.toContain('javascript:');
      expect(data.body.en).not.toContain('onclick');
      expect(data.body.en).toContain('<p>Hello</p>');
    });

    it('strips the same on the update write', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'c', status: 'DRAFT' });
      prisma.campaign.update.mockResolvedValue({ id: 'c' });
      await service.update('c', { body: HOSTILE });
      const data = prisma.campaign.update.mock.calls[0][0].data;
      expect(data.body.fr).not.toContain('<script');
      expect(data.body.en).not.toContain('javascript:');
    });

    it('strips before rendering the preview, so the operator sees what sends', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: null,
        subject: { fr: 'Offre', en: 'Offer' },
        body: HOSTILE,
      });
      const res = await service.preview('c', {});
      expect(res.fr.html).not.toContain('<script');
      expect(res.en.html).not.toContain('javascript:');
    });

    it('strips a hostile draft body that was never persisted', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: null,
        subject: { fr: 'Offre', en: 'Offer' },
        body: { fr: '<p>ok</p>', en: '<p>ok</p>' },
      });
      const res = await service.preview('c', { body: HOSTILE });
      expect(res.fr.html).not.toContain('<script');
      expect(res.en.html).not.toContain('onclick');
    });
  });

  describe('list', () => {
    /** The service reads the page + total out of one $transaction tuple. */
    function transactionReturns(rows: unknown[], total: number) {
      prisma.$transaction.mockResolvedValue([rows, total]);
    }

    it('returns the page rows with their pagination meta', async () => {
      transactionReturns([{ id: 'camp1' }, { id: 'camp2' }], 7);
      await expect(service.list({ page: 2, pageSize: 2 })).resolves.toEqual({
        data: [{ id: 'camp1' }, { id: 'camp2' }],
        meta: { page: 2, pageSize: 2, total: 7 },
      });
    });

    it('defaults to page 1 / pageSize 20, newest first, with no filter', async () => {
      transactionReturns([], 0);
      const res = await service.list({});
      const args = prisma.campaign.findMany.mock.calls[0][0];
      expect(args).toEqual({ where: {}, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 });
      expect(res.meta).toEqual({ page: 1, pageSize: 20, total: 0 });
    });

    it('filters by status and kind, and counts under the same where', async () => {
      transactionReturns([], 0);
      await service.list({ status: 'SENT', kind: 'WINBACK' });
      const where = { status: 'SENT', kind: 'WINBACK' };
      expect(prisma.campaign.findMany.mock.calls[0][0].where).toEqual(where);
      expect(prisma.campaign.count).toHaveBeenCalledWith({ where });
    });

    it('offsets by the requested page', async () => {
      transactionReturns([], 0);
      await service.list({ page: 3, pageSize: 10 });
      const args = prisma.campaign.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });

    it('clamps a hostile page size to 100 and a page below 1 to the first page', async () => {
      transactionReturns([], 0);
      const res = await service.list({ page: 0, pageSize: 5000 });
      const args = prisma.campaign.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
      expect(args.skip).toBe(0);
      expect(res.meta).toEqual({ page: 1, pageSize: 100, total: 0 });
    });

    it('clamps a zero page size to one row rather than an unbounded read', async () => {
      transactionReturns([], 0);
      const res = await service.list({ pageSize: 0 });
      expect(prisma.campaign.findMany.mock.calls[0][0].take).toBe(1);
      expect(res.meta.pageSize).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns the campaign', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp1', status: 'DRAFT' });
      await expect(service.findOne('camp1')).resolves.toEqual({ id: 'camp1', status: 'DRAFT' });
      expect(prisma.campaign.findFirst).toHaveBeenCalledWith({ where: { id: 'camp1' } });
    });

    it('404s an unknown campaign', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects editing a non-DRAFT/SCHEDULED campaign', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'c', status: 'SENT' });
      await expect(service.update('c', { name: 'x' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('soft-deletes — stamps deletedAt, never a hard delete, and returns the id', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'c', status: 'DRAFT' });
      prisma.campaign.update.mockResolvedValue({ id: 'c' });

      await expect(service.remove('c')).resolves.toEqual({ id: 'c' });

      expect(prisma.campaign.update).toHaveBeenCalledTimes(1);
      const call = prisma.campaign.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'c' });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(Object.keys(call.data)).toEqual(['deletedAt']);
    });

    it('404s an unknown campaign without writing', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    // Deliberately unlike `update`/`send`, which both 409 a terminal campaign:
    // removal is an archive gesture, so an already-SENT campaign leaves the
    // operator's list while its CampaignSend audit rows stay untouched.
    it('soft-deletes an already-SENT campaign instead of 409ing it', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'sent1',
        status: 'SENT',
        sentAt: new Date(),
      });
      prisma.campaign.update.mockResolvedValue({ id: 'sent1' });

      await expect(service.remove('sent1')).resolves.toEqual({ id: 'sent1' });
      expect(prisma.campaign.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      expect(prisma.campaignSend.upsert).not.toHaveBeenCalled();
    });

    it('leaves a SENDING campaign removable too (no in-flight guard)', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'busy', status: 'SENDING' });
      prisma.campaign.update.mockResolvedValue({ id: 'busy' });
      await expect(service.remove('busy')).resolves.toEqual({ id: 'busy' });
    });
  });

  describe('send', () => {
    it('rejects sending a non-sendable campaign', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'c', status: 'SENDING' });
      await expect(service.send('c')).rejects.toBeInstanceOf(ConflictException);
    });

    it('transitions to SENDING and enqueues the first batch on the campaign queue', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        status: 'DRAFT',
        couponCode: null,
        sentAt: null,
      });
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
      const res = await service.send('c');
      expect(res).toEqual({ id: 'c', status: 'SENDING' });
      const transition = prisma.campaign.updateMany.mock.calls[0][0];
      expect(transition.where.status).toEqual({ in: ['DRAFT', 'SCHEDULED'] });
      expect(transition.data.status).toBe('SENDING');
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — a concurrent double-send that loses the guarded transition 409s without enqueuing', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        status: 'DRAFT',
        couponCode: null,
        sentAt: null,
      });
      prisma.campaign.updateMany.mockResolvedValue({ count: 0 }); // another worker already flipped it
      await expect(service.send('c')).rejects.toBeInstanceOf(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('404s an unknown campaign', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);
      await expect(service.send('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('processBatch', () => {
    function broadcast(overrides: Record<string, unknown> = {}) {
      return {
        id: 'c',
        kind: 'BROADCAST',
        segment: 'ALL_CONFIRMED',
        status: 'SENDING',
        couponCode: null,
        subject: { en: 's' },
        body: { en: 'b' },
        ...overrides,
      };
    }

    it('exits without sending when the campaign is not SENDING', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast({ status: 'CANCELLED' }));
      await expect(service.processBatch('c')).resolves.toEqual({ done: true, sent: 0 });
      expect(resend.sendBatch).not.toHaveBeenCalled();
    });

    it('marks the campaign SENT when no eligible recipients remain', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue([]);
      await expect(service.processBatch('c')).resolves.toEqual({ done: true, sent: 0 });
      const sent = prisma.campaign.updateMany.mock.calls[0][0];
      expect(sent.where.status).toBe('SENDING');
      expect(sent.data.status).toBe('SENT');
    });

    it('batch-sends eligible subscribers, records each, and completes', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x', locale: 'en', userId: null },
        { id: 's2', email: 'b@x', locale: 'fr', userId: null },
      ]);
      const res = await service.processBatch('c');
      expect(resend.sendBatch).toHaveBeenCalledTimes(1);
      const [items, opts] = resend.sendBatch.mock.calls[0];
      expect(items).toHaveLength(2);
      expect(opts.idempotencyKey).toMatch(/^campaign:c:/);
      expect(items[0].headers['List-Unsubscribe']).toBeDefined();
      expect(prisma.campaignSend.upsert).toHaveBeenCalledTimes(2);
      expect(res.done).toBe(true);
    });

    // Proves the identity module's composition reaches the real transport, not
    // just that `resolveMailIdentity` returns the right string in isolation.
    it('hands the composed `Name <address>` From: header to the batch transport', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x', locale: 'en', userId: null },
      ]);
      await service.processBatch('c');
      const items = resend.sendBatch.mock.calls[0][0];
      expect(items[0].from).toBe(EXPECTED_FROM);
    });

    it('recomposes the From: header from a deployment-configured identity', async () => {
      service = new CampaignService(
        prisma as never,
        makeConfig({
          RESEND_FROM_NAME: 'Cabinet Example',
          RESEND_FROM_EMAIL: 'campagnes@example.test',
        }) as never,
        resend as never,
        suppression as never,
        preferences as never,
        queue as never,
        settings as never,
      );
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x', locale: 'fr', userId: null },
      ]);
      await service.processBatch('c');
      expect(resend.sendBatch.mock.calls[0][0][0].from).toBe(
        'Cabinet Example <campagnes@example.test>',
      );
    });

    it('records suppressed recipients and excludes them from the batch', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue([
        { id: 's1', email: 'good@x', locale: 'en', userId: null },
        { id: 's2', email: 'bounced@x', locale: 'en', userId: null },
      ]);
      suppression.isSuppressed.mockImplementation((e: string) =>
        Promise.resolve(e === 'bounced@x'),
      );
      await service.processBatch('c');
      const sentItems = resend.sendBatch.mock.calls[0][0];
      expect(sentItems).toHaveLength(1);
      expect(sentItems[0].to).toBe('good@x');
      const suppressedUpsert = prisma.campaignSend.upsert.mock.calls.find(
        (c) => c[0].create?.recipient === 'bounced@x',
      );
      expect(suppressedUpsert[0].create.status).toBe('suppressed');
    });

    it('re-enqueues the next batch when more than one batch of recipients remain', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue(
        Array.from({ length: 150 }, (_, i) => ({
          id: `s${i}`,
          email: `u${i}@x`,
          locale: 'en',
          userId: null,
        })),
      );
      const res = await service.processBatch('c');
      expect(resend.sendBatch.mock.calls[0][0]).toHaveLength(100);
      expect(res.done).toBe(false);
      expect(queue.add).toHaveBeenCalledTimes(1); // next batch enqueued
      // not marked SENT yet
      const sentUpdate = prisma.campaign.updateMany.mock.calls.find(
        (c) => c[0].data?.status === 'SENT',
      );
      expect(sentUpdate).toBeUndefined();
    });

    it('skips recipients already recorded (idempotent re-run)', async () => {
      prisma.campaign.findFirst.mockResolvedValue(broadcast());
      prisma.subscriber.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x', locale: 'en', userId: null },
      ]);
      prisma.campaignSend.findMany.mockResolvedValue([{ recipient: 'a@x' }]);
      const res = await service.processBatch('c');
      expect(resend.sendBatch).not.toHaveBeenCalled();
      expect(res).toEqual({ done: true, sent: 0 });
    });
  });

  describe('resolveRecipients', () => {
    it('WINBACK resolves lapsed consenting users with subscriberId null', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: 'lapsed@x', locale: 'fr' }]);
      const recips = await service.resolveRecipients({
        id: 'c',
        kind: 'WINBACK',
        segment: 'LAPSED',
      });
      expect(recips).toEqual([
        { email: 'lapsed@x', locale: 'fr', subscriberId: null, userId: 'u1' },
      ]);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.notificationPreferences.some).toMatchObject({
        category: 'MARKETING',
        email: true,
      });
      // Cross-ledger consent (security M-1): exclude newsletter-unsubscribed users.
      expect(where.subscribers).toEqual({
        none: { unsubscribedAt: { not: null }, deletedAt: null },
      });
    });

    it('resolves a recipient row carrying neither store locale to fr', async () => {
      prisma.subscriber.findMany.mockResolvedValue([
        { id: 's1', email: 'stale@x', locale: 'ar', userId: null },
        { id: 's2', email: 'blank@x', locale: null, userId: null },
      ]);
      const recips = await service.resolveRecipients({
        id: 'c',
        kind: 'BROADCAST',
        segment: 'ALL_CONFIRMED',
      });
      expect(recips.map((r) => r.locale)).toEqual(['fr', 'fr']);
    });

    it('BROADCAST excludes MARKETING-opted-out account users (cross-ledger consent, M-1)', async () => {
      prisma.subscriber.findMany.mockResolvedValue([]);
      await service.resolveRecipients({ id: 'c', kind: 'BROADCAST', segment: 'ALL_CONFIRMED' });
      const where = prisma.subscriber.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { userId: null },
        {
          user: {
            is: {
              deletedAt: null,
              notificationPreferences: {
                none: { category: 'MARKETING', email: false, deletedAt: null },
              },
            },
          },
        },
      ]);
    });
  });

  describe('preview', () => {
    const draftBody = {
      fr: '<p>{{discountLabel}} sur {{shopUrl}}</p>',
      en: '<p>{{discountLabel}} at {{shopUrl}}</p>',
    };

    function campaignWithCoupon(promo: { type: string; value: unknown } | null) {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: promo ? 'SAVE' : null,
        subject: { fr: 'Offre', en: 'Offer' },
        body: draftBody,
      });
      prisma.promotion.findFirst.mockResolvedValue(promo);
    }

    it('renders exactly the enabled locales, no more', async () => {
      campaignWithCoupon(null);
      const res = await service.preview('c', {});
      expect(Object.keys(res).sort()).toEqual(['en', 'fr']);
    });

    it('renders every locale the mail templates ship copy for when all are enabled', async () => {
      storeLocales.set(NEUTRAL_LOCALE_SET);
      campaignWithCoupon(null);
      const res = await service.preview('c', {});
      expect(Object.keys(res).sort()).toEqual([...MAIL_LOCALES].sort());
    });

    it('404s an unknown campaign', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);
      await expect(service.preview('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('labels a FREE_SHIPPING coupon in each locale', async () => {
      campaignWithCoupon({ type: 'FREE_SHIPPING', value: null });
      const res = await service.preview('c', {});
      expect(res.fr.html).toContain('livraison offerte');
      expect(res.en.html).toContain('free shipping');
    });

    it('labels a FREE_SHIPPING coupon in Arabic', async () => {
      storeLocales.set(NEUTRAL_LOCALE_SET);
      campaignWithCoupon({ type: 'FREE_SHIPPING', value: null });
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: 'SAVE',
        subject: { ar: 'عرض' },
        body: { ar: '<p>{{discountLabel}}</p>' },
      });
      const res = await service.preview('c', {});
      expect(res.ar.html).toContain('شحن مجاني');
    });

    it('labels a FREE_SHIPPING coupon in the store default for a locale with no label', () => {
      const remove = registerScratchLocale('xx');
      storeLocales.set({
        supportedLocales: ['fr', 'en', 'xx'],
        defaultLocale: 'fr',
        rtlLocales: [],
        timezone: 'UTC',
      });
      try {
        const label = (
          service as unknown as {
            discountLabel(type: string, value: unknown, locale: string): string;
          }
        ).discountLabel('FREE_SHIPPING', null, 'xx');
        expect(label).toBe('livraison offerte');
      } finally {
        remove();
      }
    });

    // The third arm of the switch. It is the only one that does not vary by
    // locale, which is why it went untested; pinned so a later edit cannot give
    // it a locale-specific shape without a failing test saying so.
    it('renders a PERCENTAGE coupon the same way in both locales', async () => {
      campaignWithCoupon({ type: 'PERCENTAGE', value: 15 });
      const res = await service.preview('c', {});
      expect(res.fr.html).toContain('15%');
      expect(res.en.html).toContain('15%');
    });

    it('renders a FIXED_AMOUNT coupon in the store money format, the same in every locale', async () => {
      campaignWithCoupon({ type: 'FIXED_AMOUNT', value: 1240 });
      const res = await service.preview('c', {});
      expect(res.fr.html).toContain(`1${NARROW_NO_BREAK_SPACE}240,000${NO_BREAK_SPACE}LD`);
      expect(res.en.html).toContain(`1${NARROW_NO_BREAK_SPACE}240,000${NO_BREAK_SPACE}LD`);
    });

    it('prints the runtime store name in every locale (DR-31)', async () => {
      campaignWithCoupon(null);
      const res = await service.preview('c', {});
      expect(settings.get).toHaveBeenCalledWith('storeName');
      expect(res.fr.html).toContain(STORE_NAME);
      expect(res.en.html).toContain(STORE_NAME);
    });

    it('points the shop URL at the configured storefront, locale-prefixed', async () => {
      campaignWithCoupon(null);
      const res = await service.preview('c', {});
      expect(res.fr.html).toContain('https://storefront.example.test/fr');
      expect(res.en.html).toContain('https://storefront.example.test/en');
    });

    it('falls back to the example.test storefront when no origin is configured', async () => {
      const saved = process.env.STOREFRONT_PUBLIC_BASE_URL;
      delete process.env.STOREFRONT_PUBLIC_BASE_URL;
      try {
        service = new CampaignService(
          prisma as never,
          makeConfig({ STOREFRONT_PUBLIC_BASE_URL: undefined }) as never,
          resend as never,
          suppression as never,
          preferences as never,
          queue as never,
          settings as never,
        );
        campaignWithCoupon(null);
        const res = await service.preview('c', {});
        expect(res.fr.html).toContain('https://storefront.example.test/fr');
      } finally {
        if (saved !== undefined) process.env.STOREFRONT_PUBLIC_BASE_URL = saved;
      }
    });
  });

  describe('stats', () => {
    it('aggregates CampaignSend counts by status', async () => {
      prisma.campaignSend.groupBy.mockResolvedValue([
        { status: 'sent', _count: { _all: 8 } },
        { status: 'suppressed', _count: { _all: 2 } },
      ]);
      await expect(service.stats('c')).resolves.toEqual({ total: 10, sent: 8, suppressed: 2 });
    });
  });

  describe('sendTest', () => {
    it('resolves the operator email and sends one rendered email', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: null,
        subject: { en: 's' },
        body: { en: 'b' },
      });
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@x' });
      const res = await service.sendTest('c', 'admin1', 'en');
      expect(res).toEqual({ status: 'sent', recipient: 'admin@x' });
      expect(resend.send).toHaveBeenCalledTimes(1);
    });

    it('sends the test from the composed identity, with the configured reply-to', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: null,
        subject: { en: 's' },
        body: { en: 'b' },
      });
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@x' });
      await service.sendTest('c', 'admin1', 'en');
      const args = resend.send.mock.calls[0][0];
      expect(args.from).toBe(EXPECTED_FROM);
      expect(args.replyTo).toBe('contact@example.test');
    });

    it('400s when the operator has no email', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: null,
        subject: {},
        body: {},
      });
      prisma.user.findUnique.mockResolvedValue({ email: null });
      await expect(service.sendTest('c', 'admin1', 'en')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it.each([['production'], ['staging'], ['prod'], [undefined]])(
    'ignores MAIL_DEV_REDIRECT_TO under NODE_ENV=%s (every label outside test and development is production)',
    async (label) => {
      const originalEnv = process.env.NODE_ENV;
      if (label === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = label;
      try {
        const redirected = makeConfig({ MAIL_DEV_REDIRECT_TO: 'qa@example.test' });
        const svc = new CampaignService(
          prisma as never,
          redirected as never,
          resend as never,
          suppression as never,
          preferences as never,
          queue as never,
          settings as never,
        );
        prisma.campaign.findFirst.mockResolvedValue({
          id: 'c',
          couponCode: null,
          subject: { en: 's' },
          body: { en: 'b' },
        });
        prisma.user.findUnique.mockResolvedValue({ email: 'admin@x' });
        await svc.sendTest('c', 'admin1', 'en');
        expect(resend.send.mock.calls[0][0].to).toBe('admin@x');
      } finally {
        if (originalEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalEnv;
      }
    },
  );

  it('honours MAIL_DEV_REDIRECT_TO under NODE_ENV=development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const redirected = makeConfig({ MAIL_DEV_REDIRECT_TO: 'qa@example.test' });
      const svc = new CampaignService(
        prisma as never,
        redirected as never,
        resend as never,
        suppression as never,
        preferences as never,
        queue as never,
        settings as never,
      );
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'c',
        couponCode: null,
        subject: { en: 's' },
        body: { en: 'b' },
      });
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@x' });
      await svc.sendTest('c', 'admin1', 'en');
      expect(resend.send.mock.calls[0][0].to).toBe('qa@example.test');
    } finally {
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    }
  });
});
