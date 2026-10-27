/**
 * Public enqueue API for every transactional email.
 *
 * Contract: `enqueue()` writes a NotificationLog row in `status='queued'`
 * BEFORE returning. Callers can therefore treat the call as audit-confirmed
 * even if the actual send is still pending in BullMQ. This matters for two
 * reasons:
 *
 *  1. The auth e2e helper `recentActionUrl()` polls NotificationLog within
 *     ~50ms of an auth callback firing — and must find the row even before
 *     the worker has had a chance to drain the queue. Writing the log
 *     first preserves that contract (see `test/e2e/helpers.ts:182-197`).
 *
 *  2. EmailSuppression hits short-circuit *without* a queue add, but still
 *     record `status='suppressed'` so operators see attempts to send to
 *     known-bad addresses in the admin notifications log.
 *
 * The BullMQ `jobId` equals the NotificationLog row id — this doubles as
 * Resend's `Idempotency-Key`, so a BullMQ retry of the same job dedupes at
 * the provider too.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { isProduction } from '@common/env';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { SuppressionService } from './suppression.service';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  MAIL_QUEUE,
  NOTIFICATION_CHANNEL_EMAIL,
  NOTIFICATION_TEMPLATE_CHANGED_EVENT,
  NOTIFICATIONS_PAUSE_SETTING,
  isLockedFlow,
} from './mail.constants';
import type {
  MailEnqueueInput,
  MailEnqueueResult,
  MailJobName,
  MailJobPayload,
} from './mail.types';

/** Cached per-flow send flags — keyed by MailJobName in MailService. */
interface FlowFlags {
  sendEnabled: boolean;
  isLocked: boolean;
  /** NotificationTemplate id for the flow `code`, or null when un-seeded. */
  templateId: string | null;
  /**
   * Delivery class (NE7). TRANSACTIONAL bypasses the consent gate; LIFECYCLE /
   * MARKETING require per-user opt-in. Defaults TRANSACTIONAL for an un-seeded
   * flow (a missing row must never silently gate a transactional send).
   */
  category: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /**
   * In-memory send-flag cache (Risk R3) — one round-trip-free lookup per flow.
   * Cleared wholesale on the `notification-template.changed` event (so an admin
   * toggle propagates immediately) and refreshed past a short TTL backstop in
   * case an event is ever missed. The pause flag is cached separately because
   * it lives in StoreSetting, not NotificationTemplate.
   */
  private readonly flagCache = new Map<MailJobName, FlowFlags>();
  private flagCacheExpiry = 0;
  private pauseCache: { value: boolean; expiry: number } | null = null;
  private static readonly FLAG_TTL_MS = 60_000;
  private static readonly PAUSE_TTL_MS = 30_000;

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly suppression: SuppressionService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  async enqueue<V extends Record<string, unknown> = Record<string, unknown>>(
    name: MailJobName,
    input: MailEnqueueInput<V>,
  ): Promise<MailEnqueueResult> {
    const isProd = isProduction();
    const recipient = this.resolveRecipient(input.to);

    // 0. Idempotent dedupe short-circuit (NE2). Only when the caller supplies a
    //    stable key — all 14 transactional flows pass none, so their path is
    //    untouched. A repeated enqueue of the same logical send (admin double-
    //    click, retried request) returns the original dispatch instead of
    //    writing a second audit row and mailing the recipient twice. BullMQ
    //    retains completed/failed jobs (`removeOnComplete`/`removeOnFail`), so a
    //    just-processed resend still resolves here; once evicted, a later
    //    deliberate resend is free to dispatch again.
    if (input.dedupeKey) {
      const existing = await this.queue.getJob(input.dedupeKey);
      if (existing) {
        const originalLogId = (existing.data as Partial<MailJobPayload>)?.logId ?? '';
        this.logger.log(
          `dedupe-hit: code=${name} recipient=${recipient} jobId=${input.dedupeKey} logId=${originalLogId}`,
        );
        return { logId: originalLogId, jobId: input.dedupeKey, suppressed: false, deduped: true };
      }
    }

    // Resolve the flow's flags + template id once (cached). `templateId` links
    // every audit row written below back to its NotificationTemplate so the
    // admin send-log can join a dispatch to its template (NE2 log↔template
    // linkage). Null when the flow has no DB row — the FK stays unset, as before.
    const flags = await this.getFlowFlags(name);
    const templateLink = flags.templateId ? { templateId: flags.templateId } : {};

    // 1. Suppression short-circuit — never silently swallow; record an audit row.
    if (await this.suppression.isSuppressed(recipient)) {
      const log = await this.prisma.notificationLog.create({
        data: {
          ...templateLink,
          templateCode: name,
          channel: NOTIFICATION_CHANNEL_EMAIL,
          recipient,
          status: 'suppressed',
          metadata: {
            locale: input.locale,
            variables: this.safeMetadata(input.variables),
            reason: 'EmailSuppression hit',
          },
        },
      });
      this.logger.warn(`suppressed: code=${name} recipient=${recipient} logId=${log.id}`);
      return { logId: log.id, jobId: undefined, suppressed: true };
    }

    // 2. Kill-switch gate — consult the per-flow send flag before the queue
    //    add (mirrors the suppression short-circuit). A locked flow — by the
    //    hardcoded security/legal floor OR the DB `isLocked` column — is never
    //    skipped, so auth/order mail can never be silently darkened. When a
    //    non-locked flow is off (per-flow toggle or global pause), write a
    //    `status='skipped'` audit row and return without enqueuing.
    const locked = isLockedFlow(name) || flags.isLocked;
    if (!locked) {
      const paused = await this.isGloballyPaused();
      if (paused || !flags.sendEnabled) {
        const reason = paused ? 'global pause' : 'sendEnabled=false';
        const log = await this.prisma.notificationLog.create({
          data: {
            ...templateLink,
            templateCode: name,
            channel: NOTIFICATION_CHANNEL_EMAIL,
            recipient,
            status: 'skipped',
            metadata: {
              locale: input.locale,
              variables: this.safeMetadata(input.variables),
              reason,
            },
          },
        });
        this.logger.log(
          `skipped: code=${name} recipient=${recipient} logId=${log.id} reason=${reason}`,
        );
        return { logId: log.id, jobId: undefined, suppressed: false, skipped: true };
      }
    }

    // 2b. Consent gate (NE7) — LIFECYCLE/MARKETING flows require per-user opt-in
    //     (CAN-SPAM/GDPR). Runs ONLY for a non-locked, non-transactional flow, so
    //     the transactional ~99% hot path takes no extra round-trip. Consent is
    //     resolved against the ORIGINAL recipient (`input.to`), never the
    //     dev-redirected address, so a staging redirect never changes the
    //     decision. When consented, mint the one-click unsubscribe URL from the
    //     resolved userId so the processor can attach the RFC 8058 headers +
    //     footer link (no second user lookup).
    let listUnsubscribeUrl: string | undefined;
    if (!locked && flags.category !== 'TRANSACTIONAL' && !input.bypassConsent) {
      const consent = await this.preferences.resolveEmailConsent(input.to, flags.category);
      if (!consent.consented) {
        const log = await this.prisma.notificationLog.create({
          data: {
            ...templateLink,
            templateCode: name,
            channel: NOTIFICATION_CHANNEL_EMAIL,
            recipient,
            status: 'skipped',
            metadata: {
              locale: input.locale,
              variables: this.safeMetadata(input.variables),
              reason: 'no-consent',
            },
          },
        });
        this.logger.log(
          `skipped: code=${name} recipient=${recipient} logId=${log.id} reason=no-consent`,
        );
        return { logId: log.id, jobId: undefined, suppressed: false, skipped: true };
      }
      if (consent.userId) {
        listUnsubscribeUrl = this.preferences.buildUnsubscribeUrl(
          consent.userId,
          flags.category,
          input.locale,
        );
      }
    }

    // 3. Audit row first — the e2e helper depends on this row existing before
    //    BullMQ processes the job.
    const log = await this.prisma.notificationLog.create({
      data: {
        ...templateLink,
        templateCode: name,
        channel: NOTIFICATION_CHANNEL_EMAIL,
        recipient,
        status: 'queued',
        metadata: {
          locale: input.locale,
          variables: this.safeMetadata(input.variables),
          // actionUrl is a single-use credential — recorded outside prod only
          // so dev + e2e + staging QA can follow the link.
          ...(input.actionUrl && !isProd ? { actionUrl: input.actionUrl } : {}),
        },
      },
    });

    // 4. Hand off to BullMQ. jobId = the caller's stable dedupeKey when supplied
    //    (so a repeat enqueue dedupes), else the logId — either way the
    //    processor matches the row via payload.logId and Resend dedupes retries
    //    via the same Idempotency-Key.
    const payload: MailJobPayload<V> = {
      to: recipient,
      locale: input.locale,
      variables: input.variables,
      logId: log.id,
      ...(input.actionUrl ? { actionUrl: input.actionUrl } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.bcc && input.bcc.length > 0 ? { bcc: input.bcc } : {}),
      ...(listUnsubscribeUrl ? { listUnsubscribeUrl } : {}),
    };
    let job;
    try {
      job = await this.queue.add(name, payload, { jobId: input.dedupeKey ?? log.id });
    } catch (addErr) {
      // The audit row already exists in `status='queued'` — promote it to
      // `enqueue-failed` rather than leaving it orphaned behind a job that was
      // never created, and return without throwing so a transient queue/Redis
      // outage never interrupts the originating domain mutation (NE4, Risk R10).
      const reason = (addErr as Error).message;
      this.logger.error(`enqueue failed (queue.add): code=${name} logId=${log.id}: ${reason}`);
      try {
        await this.prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'enqueue-failed', error: reason },
        });
      } catch (updErr) {
        this.logger.error(
          `failed to mark enqueue-failed for logId=${log.id}: ${(updErr as Error).message}`,
        );
      }
      return { logId: log.id, jobId: undefined, suppressed: false, enqueueFailed: true };
    }

    this.logger.log(
      `enqueued: code=${name} recipient=${recipient} logId=${log.id} jobId=${job.id}`,
    );
    return { logId: log.id, jobId: job.id, suppressed: false };
  }

  /**
   * Record a dispatch-bridge failure (Risk R10) — the resolver threw, or
   * enqueue blew up before a row existed — as a NotificationLog
   * `status='enqueue-failed'` row, so a dropped email is never silent. Called by
   * `MailDispatchListener.dispatch` from its catch block.
   *
   * Self-guarding: a failure to WRITE the audit row is only logged. The
   * fire-and-forget bridge must never throw and block the originating domain
   * mutation. `recipient` is NOT NULL in the schema, hence the `'(unresolved)'`
   * fallback for failures that occur before a recipient is known.
   */
  async recordEnqueueFailure(
    name: MailJobName,
    recipient: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const flags = await this.getFlowFlags(name);
      const templateLink = flags.templateId ? { templateId: flags.templateId } : {};
      await this.prisma.notificationLog.create({
        data: {
          ...templateLink,
          templateCode: name,
          channel: NOTIFICATION_CHANNEL_EMAIL,
          recipient: recipient || '(unresolved)',
          status: 'enqueue-failed',
          error: reason,
          metadata: { ...extra, reason },
        },
      });
      this.logger.warn(`enqueue-failed recorded: code=${name} recipient=${recipient}`);
    } catch (writeErr) {
      this.logger.error(
        `failed to record enqueue-failed for ${name}: ${(writeErr as Error).message}`,
      );
    }
  }

  /**
   * Invalidate the send-flag cache when any NotificationTemplate is created,
   * updated, or removed. NotificationTemplatesService emits the event; this
   * keeps the hot path round-trip-free while making a toggle take effect on
   * the next send (Risk R3).
   */
  @OnEvent(NOTIFICATION_TEMPLATE_CHANGED_EVENT)
  onTemplateChanged(): void {
    this.flagCache.clear();
    this.flagCacheExpiry = 0;
  }

  /**
   * Resolve a flow's send flags + template id, cached. A missing template row
   * defaults to `sendEnabled:true` (the file-fallback renderer still produces
   * copy, so an un-seeded flow must not be darkened), `isLocked:false` — the
   * hardcoded `isLockedFlow` floor still protects auth/order regardless — and
   * `templateId:null` (no FK to link).
   */
  private async getFlowFlags(code: MailJobName): Promise<FlowFlags> {
    const now = Date.now();
    if (now > this.flagCacheExpiry) {
      this.flagCache.clear();
      this.flagCacheExpiry = now + MailService.FLAG_TTL_MS;
    }
    const cached = this.flagCache.get(code);
    if (cached) return cached;

    const row = await this.prisma.notificationTemplate.findUnique({
      where: { code },
      select: { id: true, sendEnabled: true, isLocked: true, category: true },
    });
    const flags: FlowFlags = {
      sendEnabled: row?.sendEnabled ?? true,
      isLocked: row?.isLocked ?? false,
      templateId: row?.id ?? null,
      category: row?.category ?? 'TRANSACTIONAL',
    };
    this.flagCache.set(code, flags);
    return flags;
  }

  /**
   * Read the global "pause all email" StoreSetting, cached behind a short TTL.
   * Fails open (returns false) on a read error — a transient settings blip must
   * never silently darken every flow.
   */
  private async isGloballyPaused(): Promise<boolean> {
    const now = Date.now();
    if (this.pauseCache && now < this.pauseCache.expiry) {
      return this.pauseCache.value;
    }
    let value = false;
    try {
      const row = await this.prisma.storeSetting.findUnique({
        where: {
          group_key: {
            group: NOTIFICATIONS_PAUSE_SETTING.group,
            key: NOTIFICATIONS_PAUSE_SETTING.key,
          },
        },
        select: { value: true },
      });
      value = row?.value === true;
    } catch (err) {
      this.logger.error(`pause-flag read failed; failing open: ${(err as Error).message}`);
      value = false;
    }
    this.pauseCache = { value, expiry: now + MailService.PAUSE_TTL_MS };
    return value;
  }

  /**
   * Non-prod recipient override. Lets staging exercise the real Resend pipeline
   * without leaking mail to customers. `MAIL_DEV_REDIRECT_TO` MUST stay empty
   * when sending for real — `validateMailEnv` (mail.env.ts, run from main.ts at
   * boot) rejects a non-empty value under MAIL_TRANSPORT=resend (NE7, Risk R11),
   * so this guard and the boot guard are belt-and-suspenders.
   */
  private resolveRecipient(to: string): string {
    const redirect = this.config.get<string>('MAIL_DEV_REDIRECT_TO');
    if (redirect && !isProduction()) {
      return redirect;
    }
    return to;
  }

  /**
   * Strip obvious secrets from a variables dict before it lands in
   * NotificationLog.metadata — we already write the actionUrl separately
   * with explicit prod-vs-dev handling; redact the same field from the
   * generic variables blob so a future audit/export doesn't leak it.
   */
  private safeMetadata(vars: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(vars)) {
      // `otp` is the single-use 2FA second factor (NE8) — like actionUrl it
      // renders into the email body but must NEVER be persisted to the audit
      // row or any log line (constitution §3.7).
      if (k === 'actionUrl' || k === 'token' || k === 'password' || k === 'apiKey' || k === 'otp') {
        out[k] = '[redacted]';
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
