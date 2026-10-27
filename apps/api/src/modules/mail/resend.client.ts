/**
 * Thin wrapper around the Resend Node SDK so the rest of the module is
 * provider-agnostic (we can swap to Postmark/SES by replacing this file +
 * its spec). All Resend-specific knowledge lives here.
 *
 * Construction-time switches:
 *   - `MAIL_TRANSPORT=console`  → `dryRun` mode: log + return a synthetic id.
 *                                  Default for local dev + every Jest run.
 *   - `MAIL_TRANSPORT=resend`   → calls `resend.emails.send()`; key validated
 *                                  by `validateMailEnv` at boot.
 *
 * The wrapper unwraps Resend's `{ data, error }` discriminated-union return
 * into a throw on error so callers handle it like any other Promise — keeps
 * the BullMQ retry semantics in `mail.processor.ts` clean.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface ResendSendArgs {
  /** Pre-formatted `Display Name <local@domain>` header — built by config. */
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  bcc?: string[];
  replyTo?: string;
  headers?: Record<string, string>;
  /**
   * Resend `Idempotency-Key` — 24h TTL, max 256 chars, dedupes by team. We
   * pass the BullMQ `job.id` so retries of the same job do not re-send.
   */
  idempotencyKey?: string;
}

export interface ResendSendResult {
  /** Resend message id — stored on NotificationLog.metadata.providerMessageId. */
  id: string;
  /** True when the result came from dry-run mode (no network call). */
  dryRun: boolean;
}

/**
 * One item of a batch send. Same as a single send minus `idempotencyKey` — the
 * Resend batch API takes a single request-level idempotency key (passed to
 * `sendBatch`), not per-item keys, and does not support attachments/scheduledAt.
 */
export type ResendBatchItem = Omit<ResendSendArgs, 'idempotencyKey'>;

export interface ResendBatchResult {
  /** Resend message ids, index-aligned to the input items. */
  ids: string[];
  /** True when the result came from dry-run mode (no network call). */
  dryRun: boolean;
}

/** Resend hard cap on a single `batch.send` call (docs: batch-sending limits). */
export const RESEND_BATCH_MAX = 100;

@Injectable()
export class ResendClient {
  private readonly logger = new Logger(ResendClient.name);
  private readonly client: Resend | null;
  private readonly dryRun: boolean;

  constructor(private readonly config: ConfigService) {
    const transport = this.config.get<string>('MAIL_TRANSPORT', 'console');
    this.dryRun = transport !== 'resend';
    if (this.dryRun) {
      this.client = null;
      this.logger.log(`ResendClient initialised in dry-run mode (MAIL_TRANSPORT=${transport})`);
    } else {
      const apiKey = this.config.get<string>('RESEND_API_KEY');
      if (!apiKey) {
        // Defence in depth — validateMailEnv should have caught this at boot.
        throw new Error('ResendClient: RESEND_API_KEY is required when MAIL_TRANSPORT=resend');
      }
      this.client = new Resend(apiKey);
      this.logger.log('ResendClient initialised against api.resend.com');
    }
  }

  async send(args: ResendSendArgs): Promise<ResendSendResult> {
    if (this.dryRun || !this.client) {
      const id = `console_${randomUUID()}`;
      this.logger.log(`dry-run send: to=${args.to} subject=${args.subject.slice(0, 60)} id=${id}`);
      return { id, dryRun: true };
    }

    const { data, error } = await this.client.emails.send({
      from: args.from,
      to: args.to,
      ...(args.bcc && args.bcc.length > 0 ? { bcc: args.bcc } : {}),
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      ...(args.headers ? { headers: args.headers } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey.slice(0, 256) } : {}),
    });

    if (error) {
      // Resend errors include `name` (e.g. `validation_error`) + `message`.
      // We do NOT log the rendered body or recipient at error level — caller
      // adds correlation context via the BullMQ failure handler.
      throw new Error(`resend: ${error.name}: ${error.message}`);
    }
    if (!data) {
      throw new Error('resend: empty response data — provider returned no id');
    }
    return { id: data.id, dryRun: false };
  }

  /**
   * Batched send for the marketing/broadcast plane (NE9). Wraps Resend
   * `batch.send` — up to {@link RESEND_BATCH_MAX} (100) emails per call. The
   * CampaignProcessor chunks recipients to ≤100 before calling; the cap here is
   * defence-in-depth. Returns provider ids index-aligned to `items` so each
   * CampaignSend row records its own `providerMessageId`.
   */
  async sendBatch(
    items: ResendBatchItem[],
    opts?: { idempotencyKey?: string },
  ): Promise<ResendBatchResult> {
    if (items.length === 0) return { ids: [], dryRun: this.dryRun };
    if (items.length > RESEND_BATCH_MAX) {
      throw new Error(`resend batch: max ${RESEND_BATCH_MAX} per call, got ${items.length}`);
    }

    if (this.dryRun || !this.client) {
      const ids = items.map(() => `console_${randomUUID()}`);
      this.logger.log(`dry-run batch send: count=${items.length}`);
      return { ids, dryRun: true };
    }

    const { data, error } = await this.client.batch.send(
      items.map((a) => ({
        from: a.from,
        to: a.to,
        ...(a.bcc && a.bcc.length > 0 ? { bcc: a.bcc } : {}),
        subject: a.subject,
        html: a.html,
        text: a.text,
        ...(a.replyTo ? { replyTo: a.replyTo } : {}),
        ...(a.headers ? { headers: a.headers } : {}),
      })),
      opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey.slice(0, 256) } : undefined,
    );

    if (error) {
      throw new Error(`resend batch: ${error.name}: ${error.message}`);
    }
    if (!data) {
      throw new Error('resend batch: empty response data — provider returned no ids');
    }
    return { ids: data.data.map((d) => d.id), dryRun: false };
  }
}
