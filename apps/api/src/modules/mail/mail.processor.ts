/**
 * BullMQ worker — picks jobs off `mail` queue, renders the template, calls
 * Resend, and reconciles the NotificationLog audit row.
 *
 * Retry semantics:
 *   - `attempts: 3` + exponential backoff are configured on the queue
 *     registration in `mail.module.ts`.
 *   - We re-throw on any error so BullMQ schedules the next attempt.
 *   - Only on the *final* failed attempt do we mark NotificationLog `failed`
 *     — earlier attempts leave the row in `queued` so an operator looking at
 *     the log doesn't misread a transient blip as a permanent failure.
 *   - Resend's own Idempotency-Key (`= job.id`) dedupes the retry at the
 *     provider, so we don't double-send if the first attempt actually
 *     succeeded but the response was lost in transit.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { resolveTranslatable } from '@common/interceptors';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ResendClient } from './resend.client';
import { renderTemplate } from './templates/render';
import { MAIL_QUEUE, MAIL_RATE_LIMITER, MAIL_WORKER_CONCURRENCY } from './mail.constants';
import type { MailJobName, MailJobPayload } from './mail.types';
import { resolveMailIdentity } from './config/mail-identity';

@Processor(MAIL_QUEUE, {
  concurrency: MAIL_WORKER_CONCURRENCY,
  limiter: { ...MAIL_RATE_LIMITER },
})
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly resend: ResendClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<MailJobPayload>): Promise<{ providerMessageId: string }> {
    const code = job.name as MailJobName;
    const { to, locale, variables, logId, replyTo, bcc, listUnsubscribeUrl } = job.data;

    // The store name comes from the runtime config (DR-31), resolved to the
    // message locale with the same chain the Translatable interceptor uses.
    const storeName = resolveTranslatable(await this.settings.get('storeName'), locale);
    const rendered = await renderTemplate(this.prisma, code, locale, variables, {
      storeName,
      ...(listUnsubscribeUrl ? { unsubscribeUrl: listUnsubscribeUrl } : {}),
    });

    const identity = resolveMailIdentity(this.config);
    const defaultReplyTo = identity.replyTo;
    const from = identity.from;

    // RFC 8058 one-click unsubscribe (NE7) — only on consented non-transactional
    // sends, signalled by the payload carrying an unsubscribe URL. Both headers
    // are required for Gmail/Yahoo one-click; the URL points at the public API
    // POST endpoint which opts the user out from the signed token alone.
    const headers: Record<string, string> = { 'X-Entity-Ref-ID': logId };
    if (listUnsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${listUnsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    try {
      const result = await this.resend.send({
        from,
        to,
        ...(bcc && bcc.length > 0 ? { bcc } : {}),
        replyTo: replyTo ?? defaultReplyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers,
        idempotencyKey: job.id,
      });

      const existing = await this.prisma.notificationLog.findUnique({
        where: { id: logId },
        select: { metadata: true },
      });
      const prevMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
      await this.prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'sent',
          metadata: { ...prevMeta, providerMessageId: result.id, dryRun: result.dryRun },
        },
      });

      this.logger.log(
        `sent: code=${code} logId=${logId} jobId=${job.id} providerId=${result.id} dryRun=${result.dryRun}`,
      );
      return { providerMessageId: result.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attemptsConfigured = job.opts.attempts ?? 3;
      const isFinalAttempt = job.attemptsMade + 1 >= attemptsConfigured;

      if (isFinalAttempt) {
        await this.prisma.notificationLog.update({
          where: { id: logId },
          data: { status: 'failed', error: message.slice(0, 1000) },
        });
        this.logger.error(
          `failed-final: code=${code} logId=${logId} jobId=${job.id} attempts=${job.attemptsMade + 1}/${attemptsConfigured} err=${message}`,
        );
      } else {
        this.logger.warn(
          `failed-retrying: code=${code} logId=${logId} jobId=${job.id} attempt=${job.attemptsMade + 1}/${attemptsConfigured} err=${message}`,
        );
      }
      // Re-throw so BullMQ honours the retry / DLQ semantics.
      throw err;
    }
  }
}
