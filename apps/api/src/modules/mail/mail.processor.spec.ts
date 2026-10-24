import { MailProcessor } from './mail.processor';
import * as render from './templates/render';
import type { Job } from 'bullmq';
import type { MailJobPayload } from './mail.types';

function makeJob(data: Partial<MailJobPayload>, overrides: Partial<Job> = {}): Job<MailJobPayload> {
  return {
    name: 'cart.abandoned',
    id: 'job-1',
    data: { to: 'c@x.com', locale: 'en', variables: {}, logId: 'log-1', ...data } as MailJobPayload,
    opts: { attempts: 3 },
    attemptsMade: 0,
    ...overrides,
  } as unknown as Job<MailJobPayload>;
}

describe('MailProcessor', () => {
  let resend: { send: jest.Mock };
  let prisma: { notificationLog: { findUnique: jest.Mock; update: jest.Mock } };
  let config: { get: jest.Mock };
  let settings: { get: jest.Mock };
  let processor: MailProcessor;
  let renderSpy: jest.SpyInstance;

  beforeEach(() => {
    resend = { send: jest.fn().mockResolvedValue({ id: 'resend-1', dryRun: true }) };
    prisma = {
      notificationLog: {
        findUnique: jest.fn().mockResolvedValue({ metadata: {} }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    config = { get: jest.fn((k: string, d?: string) => d) };
    // The store name is a Translatable in the runtime config (DR-31).
    settings = {
      get: jest
        .fn()
        .mockResolvedValue({ default: 'Example Shop', fr: 'Boutique Exemple', en: 'Example Shop' }),
    };
    processor = new MailProcessor(
      resend as never,
      prisma as never,
      config as never,
      settings as never,
    );
    renderSpy = jest
      .spyOn(render, 'renderTemplate')
      .mockResolvedValue({ subject: 'S', html: '<p>H</p>', text: 'H' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders + sends and reconciles the log to sent', async () => {
    await processor.process(makeJob({}));
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(prisma.notificationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'sent' }),
      }),
    );
  });

  // The composed identity must reach the transport, not just resolve correctly
  // in isolation: `from` is what the customer reads in the inbox, and `replyTo`
  // is where their answer lands.
  it('hands the composed `Name <address>` From: and the identity reply-to to Resend', async () => {
    await processor.process(makeJob({}));
    const args = resend.send.mock.calls[0][0];
    expect(args.from).toBe('My Store <noreply@example.test>');
    expect(args.replyTo).toBe('contact@example.test');
  });

  it('recomposes both from a deployment-configured identity', async () => {
    const values: Record<string, string> = {
      RESEND_FROM_NAME: 'Cabinet Example',
      RESEND_FROM_EMAIL: 'bonjour@example.test',
      RESEND_REPLY_TO: 'sav@example.test',
    };
    const configured = { get: jest.fn((k: string, d?: string) => values[k] ?? d) };
    processor = new MailProcessor(
      resend as never,
      prisma as never,
      configured as never,
      settings as never,
    );

    await processor.process(makeJob({}));

    const args = resend.send.mock.calls[0][0];
    expect(args.from).toBe('Cabinet Example <bonjour@example.test>');
    expect(args.replyTo).toBe('sav@example.test');
  });

  it('lets a per-job replyTo win over the identity default, keeping the From: intact', async () => {
    await processor.process(makeJob({ replyTo: 'commandes@example.test' }));
    const args = resend.send.mock.calls[0][0];
    expect(args.replyTo).toBe('commandes@example.test');
    expect(args.from).toBe('My Store <noreply@example.test>');
  });

  it('omits the List-Unsubscribe headers for a transactional send', async () => {
    await processor.process(makeJob({}));
    const args = resend.send.mock.calls[0][0];
    expect(args.headers['List-Unsubscribe']).toBeUndefined();
    expect(args.headers['List-Unsubscribe-Post']).toBeUndefined();
    expect(renderSpy).toHaveBeenCalledWith(
      prisma,
      'cart.abandoned',
      'en',
      {},
      {
        storeName: 'Example Shop',
      },
    );
  });

  it('adds RFC 8058 headers + threads the unsubscribe URL when the payload carries one', async () => {
    const url = 'https://api.example.test/v1/unsubscribe?token=abc';
    await processor.process(makeJob({ listUnsubscribeUrl: url }));
    const args = resend.send.mock.calls[0][0];
    expect(args.headers['List-Unsubscribe']).toBe(`<${url}>`);
    expect(args.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(renderSpy).toHaveBeenCalledWith(
      prisma,
      'cart.abandoned',
      'en',
      {},
      { storeName: 'Example Shop', unsubscribeUrl: url },
    );
  });

  // Through the real renderer: the Translatable store name from the runtime
  // config (DR-31) is resolved to the job locale and reaches the subject and
  // the layout chrome of what Resend sends.
  it('renders the store name resolved to the job locale into the sent mail', async () => {
    renderSpy.mockRestore();
    const withTemplate = {
      ...prisma,
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          subject: { fr: 'Votre panier · {{storeName}}', en: 'Your cart · {{storeName}}' },
          body: { fr: '<p>Bonjour</p>', en: '<p>Hello</p>' },
        }),
      },
    };
    processor = new MailProcessor(
      resend as never,
      withTemplate as never,
      config as never,
      settings as never,
    );

    await processor.process(makeJob({ locale: 'fr' }));

    expect(settings.get).toHaveBeenCalledWith('storeName');
    const args = resend.send.mock.calls[0][0];
    expect(args.subject).toBe('Votre panier · Boutique Exemple');
    expect(args.html).toContain('Boutique Exemple');
    expect(args.html).not.toContain('Example Shop');
  });

  it('marks the log failed on the final attempt and rethrows', async () => {
    resend.send.mockRejectedValue(new Error('provider down'));
    const job = makeJob({}, { attemptsMade: 2 }); // attempt 3 of 3 = final
    await expect(processor.process(job)).rejects.toThrow('provider down');
    expect(prisma.notificationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('leaves the log queued and rethrows on a non-final attempt', async () => {
    resend.send.mockRejectedValue(new Error('transient'));
    const job = makeJob({}, { attemptsMade: 0 }); // attempt 1 of 3
    await expect(processor.process(job)).rejects.toThrow('transient');
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });
});
