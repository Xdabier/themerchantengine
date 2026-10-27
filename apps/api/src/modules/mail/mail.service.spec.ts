/**
 * MailService unit tests, pin the audit-trail contract that the auth e2e
 * helper (`test/e2e/helpers.ts:182-197`) relies on:
 *
 *   - enqueue() MUST write the NotificationLog row before returning.
 *   - The templateCode MUST equal the MailJobName byte-for-byte.
 *   - metadata.actionUrl MUST be present in non-prod when supplied.
 *   - Suppression short-circuits without a queue add and writes status='suppressed'.
 *   - MAIL_DEV_REDIRECT_TO reroutes the recipient in non-prod.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail.service';
import { SuppressionService } from './suppression.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { MAIL_QUEUE } from './mail.constants';

describe('MailService', () => {
  let service: MailService;
  let prisma: {
    notificationLog: { create: jest.Mock; update: jest.Mock };
    notificationTemplate: { findUnique: jest.Mock };
    storeSetting: { findUnique: jest.Mock };
  };
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let config: { get: jest.Mock };
  let suppression: { isSuppressed: jest.Mock };
  let preferences: { resolveEmailConsent: jest.Mock; buildUnsubscribeUrl: jest.Mock };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    prisma = {
      notificationLog: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'log-1', ...data })),
        update: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      // enqueue() consults the per-flow send flag before queue.add (NE1).
      // Default: no row → flow treated as enabled (file-fallback renderer still
      // produces copy). Individual specs override per flow.
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      // Global "pause all email" StoreSetting, default: no row → not paused.
      storeSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'log-1' }),
      // dedupeKey path (NE2) consults getJob before enqueuing, default: no
      // existing job, so a normal send proceeds.
      getJob: jest.fn().mockResolvedValue(null),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    suppression = { isSuppressed: jest.fn().mockResolvedValue(false) };
    // NE7 consent gate, only consulted for non-locked, non-transactional flows.
    // Default: consented, so a marketing-class spec that does not override sends.
    preferences = {
      resolveEmailConsent: jest.fn().mockResolvedValue({ userId: 'u1', consented: true }),
      buildUnsubscribeUrl: jest.fn().mockReturnValue('https://api.test/v1/unsubscribe?token=t'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: SuppressionService, useValue: suppression },
        { provide: NotificationPreferenceService, useValue: preferences },
        { provide: getQueueToken(MAIL_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(MailService);
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('NE7 consent gate', () => {
    const lifecycleRow = {
      id: 'tpl-1',
      sendEnabled: true,
      isLocked: false,
      category: 'LIFECYCLE',
    };

    it('skips a non-transactional flow when the recipient has not consented', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(lifecycleRow);
      preferences.resolveEmailConsent.mockResolvedValue({ userId: 'u1', consented: false });

      const result = await service.enqueue('cart.abandoned', {
        to: 'c@x.com',
        locale: 'en',
        variables: {},
      });

      expect(result.skipped).toBe(true);
      expect(queue.add).not.toHaveBeenCalled();
      const created = prisma.notificationLog.create.mock.calls.at(-1)?.[0];
      expect(created.data.status).toBe('skipped');
      expect(created.data.metadata.reason).toBe('no-consent');
    });

    it('sends + threads the unsubscribe URL when consented', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(lifecycleRow);
      preferences.resolveEmailConsent.mockResolvedValue({ userId: 'u1', consented: true });

      await service.enqueue('cart.abandoned', { to: 'c@x.com', locale: 'en', variables: {} });

      expect(preferences.buildUnsubscribeUrl).toHaveBeenCalledWith('u1', 'LIFECYCLE', 'en');
      expect(queue.add).toHaveBeenCalledTimes(1);
      const payload = queue.add.mock.calls[0][1];
      expect(payload.listUnsubscribeUrl).toBe('https://api.test/v1/unsubscribe?token=t');
    });

    it('never consults consent for a TRANSACTIONAL flow', async () => {
      // Default template row is null → category TRANSACTIONAL.
      await service.enqueue('giftcard.purchase', { to: 'c@x.com', locale: 'en', variables: {} });
      expect(preferences.resolveEmailConsent).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('never consults consent for a locked flow even if non-transactional', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({ ...lifecycleRow, isLocked: true });
      await service.enqueue('cart.abandoned', { to: 'c@x.com', locale: 'en', variables: {} });
      expect(preferences.resolveEmailConsent).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('bypasses the consent gate for an explicit self-test send (NE6)', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(lifecycleRow);
      await service.enqueue('cart.abandoned', {
        to: 'admin@x.com',
        locale: 'en',
        variables: {},
        bypassConsent: true,
      });
      expect(preferences.resolveEmailConsent).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('e2e-helper contract', () => {
    it('writes NotificationLog{queued} with templateCode + metadata.actionUrl in non-prod', async () => {
      await service.enqueue('auth.password-reset', {
        to: 'user@example.com',
        locale: 'en',
        variables: { actionUrl: 'https://api/reset?token=abc' },
        actionUrl: 'https://api/reset?token=abc',
      });

      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
      const call = prisma.notificationLog.create.mock.calls[0][0];
      expect(call.data.templateCode).toBe('auth.password-reset');
      expect(call.data.channel).toBe('email');
      expect(call.data.recipient).toBe('user@example.com');
      expect(call.data.status).toBe('queued');
      expect(call.data.metadata.actionUrl).toBe('https://api/reset?token=abc');
    });

    it('redacts actionUrl from variables blob even in non-prod', async () => {
      await service.enqueue('auth.password-reset', {
        to: 'user@example.com',
        locale: 'en',
        variables: { actionUrl: 'https://api/reset?token=abc' },
      });
      const meta = prisma.notificationLog.create.mock.calls[0][0].data.metadata;
      expect(meta.variables.actionUrl).toBe('[redacted]');
    });

    it('redacts the 2FA otp from the audit row metadata (NE8, §3.7)', async () => {
      await service.enqueue('auth.2fa-otp', {
        to: 'user@example.com',
        locale: 'en',
        variables: { otp: '123456' },
      });
      const meta = prisma.notificationLog.create.mock.calls[0][0].data.metadata;
      expect(meta.variables.otp).toBe('[redacted]');
    });

    it('OMITS metadata.actionUrl in production even when supplied', async () => {
      process.env.NODE_ENV = 'production';
      await service.enqueue('auth.password-reset', {
        to: 'user@example.com',
        locale: 'en',
        variables: { actionUrl: 'https://api/reset?token=abc' },
        actionUrl: 'https://api/reset?token=abc',
      });
      const meta = prisma.notificationLog.create.mock.calls[0][0].data.metadata;
      expect(meta.actionUrl).toBeUndefined();
    });

    it('passes BullMQ jobId = logId so Resend Idempotency-Key dedupes retries', async () => {
      await service.enqueue('auth.magic-link', {
        to: 'user@example.com',
        locale: 'en',
        variables: { actionUrl: 'https://api/magic' },
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, , opts] = queue.add.mock.calls[0];
      expect(opts.jobId).toBe('log-1');
    });
  });

  describe('suppression', () => {
    it('short-circuits enqueue and records status=suppressed', async () => {
      suppression.isSuppressed.mockResolvedValue(true);

      const result = await service.enqueue('order.placed', {
        to: 'bounced@example.com',
        locale: 'en',
        variables: { orderNumber: 'ORD-1' },
      });

      expect(result.suppressed).toBe(true);
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'suppressed', recipient: 'bounced@example.com' }),
        }),
      );
    });
  });

  describe('MAIL_DEV_REDIRECT_TO', () => {
    it('reroutes recipient in non-prod when env var set', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'MAIL_DEV_REDIRECT_TO' ? 'qa@example.test' : undefined,
      );

      await service.enqueue('order.placed', {
        to: 'real-customer@example.com',
        locale: 'en',
        variables: { orderNumber: 'ORD-1' },
      });

      expect(prisma.notificationLog.create.mock.calls[0][0].data.recipient).toBe('qa@example.test');
    });

    it('is IGNORED in production even when set', async () => {
      process.env.NODE_ENV = 'production';
      config.get.mockImplementation((key: string) =>
        key === 'MAIL_DEV_REDIRECT_TO' ? 'qa@example.test' : undefined,
      );

      await service.enqueue('order.placed', {
        to: 'real-customer@example.com',
        locale: 'en',
        variables: { orderNumber: 'ORD-1' },
      });

      expect(prisma.notificationLog.create.mock.calls[0][0].data.recipient).toBe(
        'real-customer@example.com',
      );
    });
  });

  it.each([['staging'], ['prod'], [undefined]])(
    'is IGNORED under NODE_ENV=%s, because every label outside test and development is production',
    async (label) => {
      if (label === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = label;
      config.get.mockImplementation((key: string) =>
        key === 'MAIL_DEV_REDIRECT_TO' ? 'qa@example.test' : undefined,
      );

      await service.enqueue('order.placed', {
        to: 'real-customer@example.com',
        locale: 'en',
        variables: { orderNumber: 'ORD-1' },
      });

      expect(prisma.notificationLog.create.mock.calls[0][0].data.recipient).toBe(
        'real-customer@example.com',
      );
    },
  );

  // ── NE1 kill-switch: wired in MailService.enqueue ──────────────────────────
  describe('NE1 kill-switch', () => {
    it('a disabled non-locked flow writes status=skipped and does NOT enqueue', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: false,
        isLocked: false,
      });

      const result = await service.enqueue('giftcard.purchase', {
        to: 'customer@example.com',
        locale: 'en',
        variables: { code: 'GC-1' },
      });

      expect(queue.add).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
      expect(result.suppressed).toBe(false);
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'skipped', templateCode: 'giftcard.purchase' }),
        }),
      );
      // The skipped reason is recorded for the operator audit trail.
      expect(prisma.notificationLog.create.mock.calls[0][0].data.metadata.reason).toBe(
        'sendEnabled=false',
      );
    });

    it('an enabled non-locked flow enqueues normally', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: true,
        isLocked: false,
      });

      const result = await service.enqueue('giftcard.purchase', {
        to: 'customer@example.com',
        locale: 'en',
        variables: { code: 'GC-1' },
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBeUndefined();
      expect(prisma.notificationLog.create.mock.calls[0][0].data.status).toBe('queued');
    });

    it('a LOCKED flow (hardcoded set) still enqueues even when sendEnabled=false', async () => {
      // order.* is in the constitutional non-disableable set, the gate must
      // ignore an "off" state for it (operator decision 2).
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: false,
        isLocked: false,
      });

      await service.enqueue('order.placed', {
        to: 'customer@example.com',
        locale: 'en',
        variables: { orderNumber: 'ORD-1' },
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(prisma.notificationLog.create.mock.calls[0][0].data.status).toBe('queued');
    });

    it('a flow locked via the DB isLocked column still enqueues when sendEnabled=false', async () => {
      // contact-form is NOT in the hardcoded set, but a DB isLocked=true must
      // also keep it sending (belt-and-suspenders).
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: false,
        isLocked: true,
      });

      await service.enqueue('contact-form', {
        to: 'staff@example.com',
        locale: 'en',
        variables: { subjectLine: 'Hello' },
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(prisma.notificationLog.create.mock.calls[0][0].data.status).toBe('queued');
    });

    it('global pause skips a non-locked flow even when sendEnabled=true', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: true,
        isLocked: false,
      });
      prisma.storeSetting.findUnique.mockResolvedValue({ value: true });

      const result = await service.enqueue('giftcard.purchase', {
        to: 'customer@example.com',
        locale: 'en',
        variables: { code: 'GC-1' },
      });

      expect(queue.add).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
      expect(prisma.notificationLog.create.mock.calls[0][0].data.metadata.reason).toBe(
        'global pause',
      );
    });

    it('global pause EXEMPTS a locked auth flow, it still enqueues', async () => {
      prisma.storeSetting.findUnique.mockResolvedValue({ value: true });

      await service.enqueue('auth.magic-link', {
        to: 'user@example.com',
        locale: 'en',
        variables: { actionUrl: 'https://api/magic' },
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(prisma.notificationLog.create.mock.calls[0][0].data.status).toBe('queued');
    });
  });

  describe('NE1 flag cache', () => {
    it('does NOT re-query the template row on a second send of the same flow (cache hit)', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: true,
        isLocked: false,
      });

      await service.enqueue('giftcard.purchase', {
        to: 'a@example.com',
        locale: 'en',
        variables: {},
      });
      await service.enqueue('giftcard.purchase', {
        to: 'b@example.com',
        locale: 'en',
        variables: {},
      });

      expect(prisma.notificationTemplate.findUnique).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('re-queries after the cache is invalidated by a template change', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        sendEnabled: true,
        isLocked: false,
      });

      await service.enqueue('giftcard.purchase', {
        to: 'a@example.com',
        locale: 'en',
        variables: {},
      });

      // Simulate the NOTIFICATION_TEMPLATE_CHANGED_EVENT the templates service emits.
      service.onTemplateChanged();

      await service.enqueue('giftcard.purchase', {
        to: 'b@example.com',
        locale: 'en',
        variables: {},
      });

      expect(prisma.notificationTemplate.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ── NE2: log↔template linkage + idempotent resend dedupe ────────────────────
  describe('NE2 templateId linkage', () => {
    it('populates NotificationLog.templateId from the resolved template on a queued send', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-99',
        sendEnabled: true,
        isLocked: false,
      });

      await service.enqueue('giftcard.purchase', {
        to: 'customer@example.com',
        locale: 'en',
        variables: { code: 'GC-1' },
      });

      expect(prisma.notificationLog.create.mock.calls[0][0].data.templateId).toBe('tmpl-99');
    });

    it('omits templateId when no DB template row backs the flow (FK stays null)', async () => {
      // Default mock: notificationTemplate.findUnique → null.
      await service.enqueue('giftcard.purchase', {
        to: 'customer@example.com',
        locale: 'en',
        variables: {},
      });

      expect(prisma.notificationLog.create.mock.calls[0][0].data.templateId).toBeUndefined();
    });

    it('links templateId on a suppressed audit row too', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-99',
        sendEnabled: true,
        isLocked: false,
      });
      suppression.isSuppressed.mockResolvedValue(true);

      await service.enqueue('giftcard.purchase', {
        to: 'bounced@example.com',
        locale: 'en',
        variables: {},
      });

      const data = prisma.notificationLog.create.mock.calls[0][0].data;
      expect(data.status).toBe('suppressed');
      expect(data.templateId).toBe('tmpl-99');
    });

    it('links templateId on a skipped audit row too', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-99',
        sendEnabled: false,
        isLocked: false,
      });

      await service.enqueue('giftcard.purchase', {
        to: 'customer@example.com',
        locale: 'en',
        variables: {},
      });

      const data = prisma.notificationLog.create.mock.calls[0][0].data;
      expect(data.status).toBe('skipped');
      expect(data.templateId).toBe('tmpl-99');
    });
  });

  describe('NE2 resend idempotency (dedupeKey)', () => {
    it('uses the dedupeKey as the BullMQ jobId on the first enqueue', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 't',
        sendEnabled: true,
        isLocked: false,
      });

      await service.enqueue('order.shipped', {
        to: 'a@b.com',
        locale: 'en',
        variables: {},
        dedupeKey: 'resend:orig',
      });

      expect(queue.getJob).toHaveBeenCalledWith('resend:orig');
      const [, , opts] = queue.add.mock.calls[0];
      expect(opts.jobId).toBe('resend:orig');
    });

    it('a second enqueue with the same dedupeKey dedupes, no second queue.add, no new log row', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 't',
        sendEnabled: true,
        isLocked: false,
      });
      // First call: no existing job → proceeds. Second call: the job is now in
      // the queue → enqueue must short-circuit to an idempotent no-op.
      queue.getJob
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'resend:orig', data: { logId: 'log-1' } });

      await service.enqueue('order.shipped', {
        to: 'a@b.com',
        locale: 'en',
        variables: {},
        dedupeKey: 'resend:orig',
      });
      const second = await service.enqueue('order.shipped', {
        to: 'a@b.com',
        locale: 'en',
        variables: {},
        dedupeKey: 'resend:orig',
      });

      expect(second.deduped).toBe(true);
      expect(second.logId).toBe('log-1');
      expect(second.jobId).toBe('resend:orig');
      // Only the first send actually enqueued + wrote an audit row.
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── NE4: enqueue-failed audit row (Risk R10) ────────────────────────────────
  describe('NE4 enqueue-failed', () => {
    it('a queue.add failure promotes the queued row to enqueue-failed and never throws', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 't',
        sendEnabled: true,
        isLocked: false,
      });
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.enqueue('giftcard.purchase', {
        to: 'c@e.com',
        locale: 'en',
        variables: {},
      });

      expect(result.enqueueFailed).toBe(true);
      expect(result.jobId).toBeUndefined();
      // The already-written queued row (id 'log-1') is promoted, not orphaned.
      expect(prisma.notificationLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: { status: 'enqueue-failed', error: 'redis down' },
      });
    });

    it('recordEnqueueFailure writes a status=enqueue-failed row with error + templateId + metadata', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-9',
        sendEnabled: true,
        isLocked: false,
      });

      await service.recordEnqueueFailure('order.placed', 'c@e.com', 'db down', {
        event: 'order.created',
      });

      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateCode: 'order.placed',
            templateId: 'tmpl-9',
            recipient: 'c@e.com',
            status: 'enqueue-failed',
            error: 'db down',
            metadata: expect.objectContaining({ event: 'order.created', reason: 'db down' }),
          }),
        }),
      );
    });

    it('recordEnqueueFailure falls back to (unresolved) when the recipient is empty', async () => {
      await service.recordEnqueueFailure('order.placed', '', 'boom');

      expect(prisma.notificationLog.create.mock.calls[0][0].data.recipient).toBe('(unresolved)');
    });

    it('recordEnqueueFailure self-guards, a write failure is swallowed, never thrown', async () => {
      prisma.notificationLog.create.mockRejectedValueOnce(new Error('db gone'));

      await expect(
        service.recordEnqueueFailure('order.placed', 'c@e.com', 'boom'),
      ).resolves.toBeUndefined();
    });
  });
});
