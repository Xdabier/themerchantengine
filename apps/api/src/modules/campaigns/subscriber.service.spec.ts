import { Prisma } from '@prisma/client';
import { SubscriberService } from './subscriber.service';
import {
  signNewsletterConfirmToken,
  signSubscriberUnsubscribeToken,
} from './newsletter-token.util';

const SECRET = 'subscriber-svc-test-secret-0123456789'; // gitleaks:allow

function makePrisma() {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    subscriber: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function makeConfig() {
  const values: Record<string, string> = {
    UNSUBSCRIBE_TOKEN_SECRET: SECRET,
    API_PUBLIC_BASE_URL: 'https://api.example.test',
    API_GLOBAL_PREFIX: 'api',
  };
  return { get: jest.fn((k: string, d?: string) => values[k] ?? d) };
}

describe('SubscriberService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let config: ReturnType<typeof makeConfig>;
  let mail: { enqueue: jest.Mock };
  let service: SubscriberService;

  beforeEach(() => {
    prisma = makePrisma();
    config = makeConfig();
    mail = { enqueue: jest.fn().mockResolvedValue({ logId: 'l1' }) };
    service = new SubscriberService(prisma as never, config as never, mail as never);
  });

  describe('subscribe', () => {
    it('creates an unconfirmed subscriber and enqueues newsletter.confirm', async () => {
      prisma.subscriber.findUnique.mockResolvedValue(null);
      prisma.subscriber.findFirst.mockResolvedValue(null);
      prisma.subscriber.create.mockResolvedValue({ id: 'sub_1' });

      await expect(service.subscribe('New@X.com ', 'fr', 'newsletter-footer')).resolves.toBe(
        'pending',
      );

      expect(prisma.subscriber.create).toHaveBeenCalledWith({
        data: { email: 'new@x.com', locale: 'fr', source: 'newsletter-footer', userId: null },
      });
      expect(mail.enqueue).toHaveBeenCalledTimes(1);
      const [code, input] = mail.enqueue.mock.calls[0];
      expect(code).toBe('newsletter.confirm');
      expect(input.to).toBe('new@x.com');
      // Must carry the API global prefix — a bare /v1/... confirm link 404s on
      // prod (regression found in prod verification 2026-06-23).
      expect(String(input.variables.confirmUrl)).toContain('/api/v1/newsletter/confirm?token=');
    });

    // D7 behaviour change: the confirm mail used to be pinned to English by a
    // CONFIRM_MAIL_LOCALE constant, so a French signup got an English mail. It
    // now renders in the subscriber's own locale.
    it('sends the double opt-in confirmation in the subscriber own locale', async () => {
      prisma.subscriber.findUnique.mockResolvedValue(null);
      prisma.subscriber.findFirst.mockResolvedValue(null);
      prisma.subscriber.create.mockResolvedValue({ id: 'sub_fr' });

      await service.subscribe('marie@x.com', 'fr', 'newsletter-footer');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'newsletter.confirm',
        expect.objectContaining({ to: 'marie@x.com', locale: 'fr' }),
      );
      const confirmUrl = String(mail.enqueue.mock.calls[0][1].variables.confirmUrl);
      expect(confirmUrl).toContain('locale=fr');
    });

    it('still sends an English signup its English confirmation', async () => {
      prisma.subscriber.findUnique.mockResolvedValue(null);
      prisma.subscriber.findFirst.mockResolvedValue(null);
      prisma.subscriber.create.mockResolvedValue({ id: 'sub_en' });

      await service.subscribe('sam@x.com', 'en', 'newsletter-footer');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'newsletter.confirm',
        expect.objectContaining({ to: 'sam@x.com', locale: 'en' }),
      );
    });

    it('canonicalizes a gmail variant before lookup/create (collapses dot/+tag abuse)', async () => {
      prisma.subscriber.findUnique.mockResolvedValue(null);
      prisma.subscriber.findFirst.mockResolvedValue(null);
      prisma.subscriber.create.mockResolvedValue({ id: 'sub_g' });

      await expect(
        service.subscribe('A.b.C+promo@Gmail.com', 'fr', 'newsletter-footer'),
      ).resolves.toBe('pending');

      // Active-row lookup + create both use the canonical identity, so every
      // dot/+tag variant of one inbox collapses to a single row.
      expect(prisma.subscriber.findUnique).toHaveBeenCalledWith({
        where: { email: 'abc@gmail.com' },
      });
      expect(prisma.subscriber.create).toHaveBeenCalledWith({
        data: { email: 'abc@gmail.com', locale: 'fr', source: 'newsletter-footer', userId: null },
      });
      expect(mail.enqueue.mock.calls[0][1].to).toBe('abc@gmail.com');
    });

    it('is a no-op for an already-confirmed address (no second confirm mail)', async () => {
      prisma.subscriber.findUnique.mockResolvedValue({
        id: 'sub_1',
        confirmedAt: new Date(),
        unsubscribedAt: null,
      });
      await expect(service.subscribe('a@x.com', 'fr', 'newsletter-footer')).resolves.toBe(
        'already-confirmed',
      );
      expect(mail.enqueue).not.toHaveBeenCalled();
      expect(prisma.subscriber.update).not.toHaveBeenCalled();
    });

    it('revives a soft-deleted row and forces a fresh confirm', async () => {
      prisma.subscriber.findUnique.mockResolvedValue(null);
      prisma.subscriber.findFirst.mockResolvedValue({ id: 'sub_old' });
      prisma.subscriber.update.mockResolvedValue({ id: 'sub_old' });

      await expect(service.subscribe('back@x.com', 'fr', 'newsletter-footer')).resolves.toBe(
        'pending',
      );
      const call = prisma.subscriber.update.mock.calls[0][0];
      expect(call.data.deletedAt).toBeNull();
      expect(call.data.confirmedAt).toBeNull();
      expect(mail.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirm', () => {
    it('sets confirmedAt for a valid token', async () => {
      prisma.subscriber.findUnique.mockResolvedValue({
        id: 'sub_1',
        confirmedAt: null,
        unsubscribedAt: null,
      });
      prisma.subscriber.update.mockResolvedValue({});
      const token = signNewsletterConfirmToken('sub_1', SECRET);
      await expect(service.confirm(token)).resolves.toEqual({ confirmed: true });
      expect(prisma.subscriber.update).toHaveBeenCalled();
    });

    it('returns confirmed:false for an invalid token without writing', async () => {
      await expect(service.confirm('garbage.token')).resolves.toEqual({ confirmed: false });
      expect(prisma.subscriber.update).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribeByToken', () => {
    it('sets unsubscribedAt for a valid token', async () => {
      prisma.subscriber.findUnique.mockResolvedValue({ id: 'sub_1', unsubscribedAt: null });
      prisma.subscriber.update.mockResolvedValue({});
      const token = signSubscriberUnsubscribeToken('sub_1', SECRET);
      await expect(service.unsubscribeByToken(token)).resolves.toEqual({ ok: true });
      const call = prisma.subscriber.update.mock.calls[0][0];
      expect(call.data.unsubscribedAt).toBeInstanceOf(Date);
    });

    it('returns ok:false for an invalid token', async () => {
      await expect(service.unsubscribeByToken('nope')).resolves.toEqual({ ok: false });
      expect(prisma.subscriber.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('builds the confirmed-status filter and paginates', async () => {
      prisma.$transaction.mockResolvedValue([[{ id: 's1' }], 1]);
      const res = await service.list({ status: 'confirmed', page: 1, pageSize: 20 });
      expect(res.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    });
  });

  describe('setUnsubscribed', () => {
    it('stamps unsubscribedAt when the operator opts a subscriber out', async () => {
      prisma.subscriber.update.mockResolvedValue({ id: 'sub_1', unsubscribedAt: new Date() });

      const res = await service.setUnsubscribed('sub_1', true);

      expect(prisma.subscriber.update).toHaveBeenCalledTimes(1);
      const call = prisma.subscriber.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'sub_1' });
      expect(call.data.unsubscribedAt).toBeInstanceOf(Date);
      expect(res).toEqual({ id: 'sub_1', unsubscribedAt: expect.any(Date) });
    });

    it('clears unsubscribedAt when the operator re-activates a subscriber', async () => {
      prisma.subscriber.update.mockResolvedValue({ id: 'sub_1', unsubscribedAt: null });

      await service.setUnsubscribed('sub_1', false);

      const call = prisma.subscriber.update.mock.calls[0][0];
      expect(call.data).toEqual({ unsubscribedAt: null });
    });

    // Re-activating never revives consent on its own: confirmedAt is untouched,
    // so a row that never completed double opt-in stays out of every campaign.
    it('touches only unsubscribedAt — never confirmedAt', async () => {
      prisma.subscriber.update.mockResolvedValue({ id: 'sub_1' });
      await service.setUnsubscribed('sub_1', false);
      expect(Object.keys(prisma.subscriber.update.mock.calls[0][0].data)).toEqual([
        'unsubscribedAt',
      ]);
    });

    // No pre-read: an unknown id surfaces as Prisma P2025, which the global
    // HttpExceptionFilter maps to the 404 the controller documents. The service
    // must not swallow it into a silent success.
    it('propagates the P2025 not-found error rather than reporting success', async () => {
      const notFound = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: '7.0.0',
        meta: {},
      });
      prisma.subscriber.update.mockRejectedValue(notFound);

      await expect(service.setUnsubscribed('missing', true)).rejects.toBe(notFound);
    });
  });
});
