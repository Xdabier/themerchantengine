import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationTemplatesService } from './notification-templates.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { NOTIFICATION_TEMPLATE_CHANGED_EVENT } from '../mail/mail.constants';
import { MAIL_LOCALES } from '../mail/mail.types';

function makeTemplate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tmpl-1',
    code: 'order.shipped',
    subject: { default: 'Your order has shipped' },
    body: { default: 'Hi {{customerName}}, your order {{orderNumber}} is on the way.' },
    channel: 'email',
    event: 'order.shipped',
    variables: ['customerName', 'orderNumber'],
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    notificationTemplate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    notificationLog: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
}

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('NotificationTemplatesService', () => {
  let service: NotificationTemplatesService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let events: { emit: jest.Mock };
  let mail: { enqueue: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    events = { emit: jest.fn() };
    mail = { enqueue: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationTemplatesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: MailService, useValue: mail },
        // The store name is a Translatable in the runtime config (DR-31).
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn(async (key: string) =>
              key === 'storeName'
                ? { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' }
                : undefined,
            ),
          },
        },
      ],
    }).compile();
    service = module.get(NotificationTemplatesService);
  });

  describe('listTemplates', () => {
    it('filters by channel + event + isEnabled', async () => {
      prisma.notificationTemplate.findMany.mockResolvedValue([makeTemplate()]);
      prisma.notificationTemplate.count.mockResolvedValue(1);
      const res = await service.listTemplates({
        channel: 'email',
        event: 'order.shipped',
        isEnabled: true,
      });
      expect(res.meta.total).toBe(1);
      const call = prisma.notificationTemplate.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        channel: 'email',
        event: 'order.shipped',
        isEnabled: true,
      });
    });
  });

  describe('findOne', () => {
    it('returns the template row', async () => {
      const template = makeTemplate();
      prisma.notificationTemplate.findUnique.mockResolvedValue(template);

      await expect(service.findOne('tmpl-1')).resolves.toBe(template);
      expect(prisma.notificationTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'tmpl-1' },
      });
    });

    it('404s an unknown template', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('names the missing id in the 404 message', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow('Template "missing" not found');
    });
  });

  describe('create', () => {
    it('409s on duplicate code', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({
          code: 'order.shipped',
          body: { default: 'x' },
          channel: 'email',
          event: 'order.shipped',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects email without subject', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          code: 'x',
          body: { default: 'x' },
          channel: 'email',
          event: 'x',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects SMS carrying a subject', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          code: 'x',
          subject: { default: 'Hi' },
          body: { default: 'Hi' },
          channel: 'sms',
          event: 'x',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists a valid email template', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplate());
      await service.create({
        code: 'order.shipped',
        subject: { default: 'Your order has shipped' },
        body: { default: 'Hi' },
        channel: 'email',
        event: 'order.shipped',
      } as never);
      expect(prisma.notificationTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'order.shipped' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('404s when the template is missing', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { isEnabled: true })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects SMS subject on update', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ channel: 'sms', subject: null }),
      );
      await expect(
        service.update('tmpl-1', { subject: { default: 'nope' } } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('NE3 sanitize-on-save', () => {
    it('create strips <script> from the body before the DB write, per-locale', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplate());
      await service.create({
        code: 'order.shipped',
        subject: { fr: 'S', en: 'S' },
        body: { en: '<p>Hi</p><script>alert(1)</script>', fr: '<p>Bonjour</p>' },
        channel: 'email',
        event: 'order.shipped',
      } as never);
      const data = prisma.notificationTemplate.create.mock.calls[0][0].data;
      expect(data.body.en).toBe('<p>Hi</p>');
      expect(data.body.fr).toBe('<p>Bonjour</p>');
    });

    it('create strips an on* handler and a javascript: href but keeps the email markup', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplate());
      await service.create({
        code: 'order.shipped',
        subject: { fr: 'S', en: 'S' },
        body: {
          en: '<div style="color:red" onclick="x()">Hi <a href="https://x.test">go</a></div>',
          fr: '<a href="javascript:alert(1)">x</a>',
        },
        channel: 'email',
        event: 'order.shipped',
      } as never);
      const data = prisma.notificationTemplate.create.mock.calls[0][0].data;
      expect(data.body.en).toContain('<div style="color:red">');
      expect(data.body.en).not.toContain('onclick');
      expect(data.body.en).toContain('<a href="https://x.test">go</a>');
      expect(data.body.fr).toBe('<a>x</a>');
    });

    it('update strips <script> from the body and isolates per-locale', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'order.shipped', isLocked: false }),
      );
      prisma.notificationTemplate.update.mockResolvedValue(makeTemplate());
      await service.update('tmpl-1', {
        body: { en: '<b>ok</b><script>bad()</script>', fr: '<p>Intact</p>' },
      } as never);
      const data = prisma.notificationTemplate.update.mock.calls[0][0].data;
      expect(data.body.en).toBe('<b>ok</b>');
      expect(data.body.fr).toBe('<p>Intact</p>');
    });
  });

  describe('NE1 send-flag + lock', () => {
    it('create persists sendEnabled + category and emits the change event', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplate());
      await service.create({
        code: 'giftcard.purchase',
        subject: { default: 'x' },
        body: { default: 'x' },
        channel: 'email',
        event: 'giftcard.purchased',
        sendEnabled: false,
        category: 'TRANSACTIONAL',
      } as never);
      expect(prisma.notificationTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sendEnabled: false, category: 'TRANSACTIONAL' }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        NOTIFICATION_TEMPLATE_CHANGED_EVENT,
        expect.objectContaining({ code: 'giftcard.purchase' }),
      );
    });

    it('update persists sendEnabled=false on an unlocked flow and emits the change event', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'giftcard.purchase', isLocked: false }),
      );
      prisma.notificationTemplate.update.mockResolvedValue(makeTemplate({ sendEnabled: false }));
      await service.update('tmpl-1', { sendEnabled: false });
      expect(prisma.notificationTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sendEnabled: false }) }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        NOTIFICATION_TEMPLATE_CHANGED_EVENT,
        expect.objectContaining({ code: 'giftcard.purchase' }),
      );
    });

    it('update REJECTS disabling a locked flow and does not write or emit', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'auth.password-reset', isLocked: true }),
      );
      await expect(service.update('tmpl-1', { sendEnabled: false })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.notificationTemplate.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('update ALLOWS editing a locked flow as long as it stays enabled', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'auth.password-reset', isLocked: true }),
      );
      prisma.notificationTemplate.update.mockResolvedValue(makeTemplate());
      await service.update('tmpl-1', { variables: ['actionUrl'] });
      expect(prisma.notificationTemplate.update).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledTimes(1);
    });

    it('remove emits the change event', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-1',
        code: 'contact-form',
      });
      prisma.notificationTemplate.delete.mockResolvedValue({});
      await service.remove('tmpl-1');
      expect(events.emit).toHaveBeenCalledWith(
        NOTIFICATION_TEMPLATE_CHANGED_EVENT,
        expect.objectContaining({ code: 'contact-form' }),
      );
    });
  });

  describe('listLog', () => {
    it('applies all filters', async () => {
      prisma.notificationLog.findMany.mockResolvedValue([]);
      prisma.notificationLog.count.mockResolvedValue(0);
      await service.listLog({
        channel: 'email',
        status: 'sent',
        templateCode: 'order.shipped',
        from: '2026-04-01T00:00:00.000Z',
      });
      const call = prisma.notificationLog.findMany.mock.calls[0][0];
      expect(call.where.channel).toBe('email');
      expect(call.where.status).toBe('sent');
      expect(call.where.templateCode).toBe('order.shipped');
      expect(call.where.sentAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('resend', () => {
    it('404s when log entry is missing', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      await expect(service.resend('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-enqueues the original via MailService with a stable dedupe key — no fabricated row', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-1',
        templateId: 'tmpl-1',
        templateCode: 'order.shipped',
        channel: 'email',
        recipient: 'a@b.com',
        metadata: { locale: 'fr', variables: { orderNumber: 'ORD-9' } },
      });
      mail.enqueue.mockResolvedValue({ logId: 'log-2', jobId: 'resend:log-1', suppressed: false });

      const res = await service.resend('log-1');

      // Re-renders + re-enqueues through the genuine pipeline: reconstructs the
      // input from the original log and passes a stable dedupe key so a
      // double-click never double-sends. The logged locale is resolved through
      // the shared resolver and reaches the enqueue unchanged.
      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({
          to: 'a@b.com',
          locale: 'fr',
          variables: { orderNumber: 'ORD-9' },
          dedupeKey: 'resend:log-1',
        }),
      );
      // The stub used to fabricate a terminal status='sent' row — it must not.
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
      expect(res).toEqual({ status: 'queued', recipient: 'a@b.com', logId: 'log-2' });
    });

    it('carries a logged en locale through to the enqueue', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-10',
        templateId: 'tmpl-1',
        templateCode: 'order.shipped',
        channel: 'email',
        recipient: 'sam@b.com',
        metadata: { locale: 'en', variables: {} },
      });
      mail.enqueue.mockResolvedValue({ logId: 'log-11', jobId: 'j', suppressed: false });

      await service.resend('log-10');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({ to: 'sam@b.com', locale: 'en' }),
      );
    });

    it('defaults locale to fr + variables to {} when the original metadata is bare', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-7',
        templateId: null,
        templateCode: 'contact-form',
        channel: 'email',
        recipient: 'c@d.com',
        metadata: null,
      });
      mail.enqueue.mockResolvedValue({ logId: 'log-8', jobId: 'resend:log-7', suppressed: false });

      await service.resend('log-7');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'contact-form',
        expect.objectContaining({
          to: 'c@d.com',
          locale: 'fr',
          variables: {},
          dedupeKey: 'resend:log-7',
        }),
      );
    });

    it('reports the honest enqueue outcome when the recipient is suppressed', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-3',
        templateId: 'tmpl-1',
        templateCode: 'order.shipped',
        channel: 'email',
        recipient: 'bounced@b.com',
        metadata: { locale: 'en', variables: {} },
      });
      mail.enqueue.mockResolvedValue({ logId: 'log-4', jobId: undefined, suppressed: true });

      const res = await service.resend('log-3');

      expect(res.status).toBe('suppressed');
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('reports the honest enqueue outcome when the flow is skipped (kill-switch off)', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-5',
        templateId: 'tmpl-1',
        templateCode: 'giftcard.purchase',
        channel: 'email',
        recipient: 'c@d.com',
        metadata: { locale: 'en', variables: {} },
      });
      mail.enqueue.mockResolvedValue({
        logId: 'log-6',
        jobId: undefined,
        suppressed: false,
        skipped: true,
      });

      const res = await service.resend('log-5');

      expect(res.status).toBe('skipped');
    });

    it('refuses to resend an auth flow — single-use credential, 400 + no enqueue', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-9',
        templateId: 'tmpl-2',
        templateCode: 'auth.password-reset',
        channel: 'email',
        recipient: 'u@v.com',
        metadata: { locale: 'en', variables: { actionUrl: '[redacted]' } },
      });

      await expect(service.resend('log-9')).rejects.toBeInstanceOf(BadRequestException);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });
  });

  // ── Desired post-fix behaviour — REALIZED at NE2 (was `it.failing` in NE0) ──
  // NE0 pinned this red via `it.failing` (tasks NE0.5); NE2 removes `.failing`
  // and makes it a normal assertion (tasks NE0 execution note). resend() now
  // re-enqueues a real job and never fabricates a terminal 'sent' row.
  describe('NE2 real resend', () => {
    it('resend does NOT fabricate a terminal status=sent row', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({
        id: 'log-1',
        templateId: 'tmpl-1',
        templateCode: 'order.shipped',
        channel: 'email',
        recipient: 'a@b.com',
        metadata: { locale: 'en', variables: {} },
      });
      mail.enqueue.mockResolvedValue({ logId: 'log-2', jobId: 'resend:log-1', suppressed: false });

      await service.resend('log-1');

      // The genuine enqueue pipeline owns the audit row now — the service writes
      // no NotificationLog row of its own, fabricated or otherwise.
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  // ── NE6: save-time variable-token validation (plan Risk R12) ────────────────
  describe('NE6 variable-token validation', () => {
    it('create rejects a body referencing a {{token}} not in variables', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          code: 'order.shipped',
          subject: { fr: 'S', en: 'S' },
          body: { en: 'Hi {{customerName}} {{ghostToken}}', fr: 'Bonjour' },
          channel: 'email',
          event: 'order.shipped',
          variables: ['customerName'],
        } as never),
      ).rejects.toMatchObject({
        response: { error: { code: 'UNKNOWN_TEMPLATE_TOKEN' } },
      });
      expect(prisma.notificationTemplate.create).not.toHaveBeenCalled();
    });

    it('create rejects a {{{rawToken}}} (triple-brace) not in variables', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          code: 'order.shipped',
          subject: { fr: 'S', en: 'S' },
          body: { en: 'Visit {{{rawUrl}}}', fr: 'x' },
          channel: 'email',
          event: 'order.shipped',
          variables: [],
        } as never),
      ).rejects.toMatchObject({ response: { error: { code: 'UNKNOWN_TEMPLATE_TOKEN' } } });
    });

    it('create accepts a body whose tokens are all declared', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      prisma.notificationTemplate.create.mockResolvedValue(makeTemplate());
      await service.create({
        code: 'order.shipped',
        subject: { fr: 'Commande {{orderNumber}}', en: 'Order {{orderNumber}}' },
        body: {
          fr: 'Bonjour {{customerName}}, commande {{orderNumber}}',
          en: 'Hi {{customerName}}, order {{orderNumber}}',
        },
        channel: 'email',
        event: 'order.shipped',
        variables: ['customerName', 'orderNumber'],
      } as never);
      expect(prisma.notificationTemplate.create).toHaveBeenCalledTimes(1);
    });

    it('update rejects a body introducing an undeclared token', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isLocked: false, variables: ['customerName'] }),
      );
      await expect(
        service.update('tmpl-1', { body: { en: 'Hi {{customerName}} {{rogue}}' } } as never),
      ).rejects.toMatchObject({ response: { error: { code: 'UNKNOWN_TEMPLATE_TOKEN' } } });
      expect(prisma.notificationTemplate.update).not.toHaveBeenCalled();
    });

    it('update accepts a new token when dto.variables expands the declared set', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isLocked: false, variables: ['customerName'] }),
      );
      prisma.notificationTemplate.update.mockResolvedValue(makeTemplate());
      await service.update('tmpl-1', {
        body: { en: 'Hi {{customerName}} — {{trackingUrl}}' },
        variables: ['customerName', 'trackingUrl'],
      } as never);
      expect(prisma.notificationTemplate.update).toHaveBeenCalledTimes(1);
    });

    it('update skips token validation when only sendEnabled changes', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate({ isLocked: false }));
      prisma.notificationTemplate.update.mockResolvedValue(makeTemplate({ sendEnabled: false }));
      await service.update('tmpl-1', { sendEnabled: false });
      expect(prisma.notificationTemplate.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── NE6: preview (server-side render of the draft, every shipped locale) ────
  describe('NE6 preview', () => {
    it('404s when the template is missing', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.preview('missing', { body: { fr: 'x', en: 'x' } } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // The response used to be a fixed `{ en, ar }` literal. It is now keyed by
    // MAIL_LOCALES, so this fails the day the renderer's locale set and the
    // preview response drift apart again.
    it('returns exactly the enabled locales, no more', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate({ variables: [] }));
      const res = await service.preview('tmpl-1', {
        body: { fr: '<p>ok</p>', en: '<p>ok</p>' },
        variables: [],
      } as never);
      expect(Object.keys(res).sort()).toEqual(['en', 'fr']);
    });

    it('returns every locale the renderer ships copy for when all are enabled', async () => {
      storeLocales.set(NEUTRAL_LOCALE_SET);
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate({ variables: [] }));
      const res = await service.preview('tmpl-1', {
        body: { fr: '<p>ok</p>', en: '<p>ok</p>' },
        variables: [],
      } as never);
      expect(Object.keys(res).sort()).toEqual([...MAIL_LOCALES].sort());
    });

    it('renders the DRAFT body for every locale wrapped in the brand layout, without persisting', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ variables: ['customerName'], subject: { fr: 'Enregistré', en: 'Saved' } }),
      );
      const res = await service.preview('tmpl-1', {
        subject: { fr: 'Brouillon FR {{customerName}}', en: 'Draft EN {{customerName}}' },
        body: { fr: '<p>Bonjour {{customerName}}</p>', en: '<p>Hello {{customerName}}</p>' },
        variables: ['customerName'],
        sampleVariables: { customerName: 'Sara' },
      } as never);

      // Draft, not the saved row.
      expect(res.en.subject).toContain('Draft EN Sara');
      expect(res.en.html).toContain('Hello Sara');
      expect(res.en.html).toContain('<!doctype html>');
      expect(res.fr.subject).toContain('Brouillon FR Sara');
      expect(res.fr.html).toContain('Bonjour Sara');
      expect(res.fr.html).toContain('lang="fr"');
      // The layout prints the runtime store name, per locale (DR-31).
      expect(res.en.html).toContain('Atlas Supplies');
      expect(res.fr.html).toContain('Atlas Supplies');
      // No write.
      expect(prisma.notificationTemplate.update).not.toHaveBeenCalled();
      expect(prisma.notificationTemplate.create).not.toHaveBeenCalled();
    });

    it('rejects a preview whose draft body has an undeclared token', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate({ variables: [] }));
      await expect(
        service.preview('tmpl-1', {
          body: { fr: 'Bonjour {{nope}}', en: 'x' },
          variables: [],
        } as never),
      ).rejects.toMatchObject({ response: { error: { code: 'UNKNOWN_TEMPLATE_TOKEN' } } });
    });

    it('sanitizes the draft body before rendering (strips <script>)', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate({ variables: [] }));
      const res = await service.preview('tmpl-1', {
        body: { en: '<p>ok</p><script>alert(1)</script>', fr: '<p>ok</p>' },
        variables: [],
      } as never);
      expect(res.en.html).not.toContain('<script>');
      expect(res.en.html).toContain('<p>ok</p>');
    });
  });

  // ── NE6: send-test (enqueue to the caller's own inbox) ──────────────────────
  describe('NE6 send-test', () => {
    it('404s when the template is missing', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);
      await expect(service.sendTest('missing', 'user-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400s when the caller has no email', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate());
      prisma.user.findUnique.mockResolvedValue({ email: null, locale: 'en' });
      await expect(service.sendTest('tmpl-1', 'user-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues the template to the caller email + reports the honest outcome', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'order.shipped', variables: ['customerName'] }),
      );
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@store.test', locale: 'fr' });
      mail.enqueue.mockResolvedValue({ logId: 'log-99', jobId: 'j', suppressed: false });

      const res = await service.sendTest('tmpl-1', 'user-1', { variables: { customerName: 'QA' } });

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({
          to: 'admin@store.test',
          locale: 'fr',
          variables: expect.objectContaining({ customerName: 'QA' }),
        }),
      );
      // Test sends are genuinely fresh — no dedupe key so an operator can re-test.
      expect(mail.enqueue.mock.calls[0][1].dedupeKey).toBeUndefined();
      expect(res).toEqual({ status: 'queued', recipient: 'admin@store.test', logId: 'log-99' });
    });

    it('prefers an explicit dto locale over the caller stored one', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'order.shipped' }),
      );
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@store.test', locale: 'fr' });
      mail.enqueue.mockResolvedValue({ logId: 'log-98', jobId: 'j', suppressed: false });

      await service.sendTest('tmpl-1', 'user-1', { locale: 'en' } as never);

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({ locale: 'en' }),
      );
    });

    // Polarity flip (D7.10): the coercion chain this path used to inline fell
    // back to en. The shared resolver writes to a stranger in French instead, so
    // a stale `ar` row or a BCP-47 tag with no template copy lands on fr.
    it('resolves a caller locale that is neither store locale to fr', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ code: 'order.shipped' }),
      );
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@store.test', locale: 'ar' });
      mail.enqueue.mockResolvedValue({ logId: 'log-97', jobId: 'j', suppressed: false });

      await service.sendTest('tmpl-1', 'user-1', {});

      expect(mail.enqueue).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({ to: 'admin@store.test', locale: 'fr' }),
      );
    });

    it('reflects a skipped (kill-switch off) outcome honestly', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(makeTemplate());
      prisma.user.findUnique.mockResolvedValue({ email: 'admin@store.test', locale: 'en' });
      mail.enqueue.mockResolvedValue({ logId: 'log-1', suppressed: false, skipped: true });

      const res = await service.sendTest('tmpl-1', 'user-1', {});

      expect(res.status).toBe('skipped');
    });
  });
});
