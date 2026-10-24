/**
 * Resend inbound webhook processor — signature verify, dedup, status update.
 *
 * Resend signs webhooks with Svix (https://docs.svix.com/receiving/verifying-payloads/how).
 * Headers:
 *   svix-id         — unique event id, used for dedup
 *   svix-timestamp  — unix seconds, reject if drift > 5 min
 *   svix-signature  — space-separated list of "vN,base64sig" pairs
 *
 * Signature algo: base64(HMAC-SHA256(secret, `${svixId}.${svixTimestamp}.${rawBody}`)).
 * Secret is the `whsec_…` value from the Resend dashboard. We strip the prefix
 * + base64-decode to get the HMAC key.
 *
 * Status mapping per the plan §3:
 *   email.sent       → status='sent', stores providerMessageId
 *   email.delivered  → status='delivered'
 *   email.bounced    → status='bounced'; hard bounces also set
 *                       User.emailDeliverability='bounced' + EmailSuppression
 *   email.complained → status='complained' + EmailSuppression + User flag
 *   email.opened     → metadata.openedAt[] appended; status untouched
 *
 * Dedup: every event id goes through ProcessedWebhookService — a replay
 * returns success without side-effects, so Resend's at-least-once retry loop
 * is safe.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcessedWebhookService } from './processed-webhook.service';
import { SuppressionService } from '../mail/suppression.service';
import { RESEND_PROVIDER } from '../mail/mail.constants';

/** Max allowed clock skew between Resend's signing time + ours. */
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface ResendWebhookEnvelope {
  raw: string;
  svixId: string | undefined;
  svixTimestamp: string | undefined;
  svixSignature: string | undefined;
}

/** Minimal shape we depend on inside the payload. */
interface ResendWebhookEvent {
  type: string;
  data: {
    email_id?: string;
    to?: string | string[];
    bounce?: { type?: string; subType?: string };
    headers?: Array<{ name: string; value: string }>;
    [k: string]: unknown;
  };
  created_at?: string;
}

@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly processed: ProcessedWebhookService,
    private readonly suppression: SuppressionService,
  ) {}

  async process(env: ResendWebhookEnvelope): Promise<{ ok: true; replay: boolean }> {
    const { raw, svixId, svixTimestamp, svixSignature } = env;
    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new UnauthorizedException('Missing Svix headers');
    }

    // 1. Timestamp window — protect against replay of an old signed body.
    const now = Math.floor(Date.now() / 1000);
    const ts = Number.parseInt(svixTimestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) {
      throw new UnauthorizedException('Timestamp outside tolerance');
    }

    // 2. Signature verify.
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    if (!secret) {
      // Fail-closed — better to 401 than to accept unverifiable events.
      throw new UnauthorizedException('Webhook secret not configured');
    }
    if (!this.verifySignature(secret, svixId, svixTimestamp, raw, svixSignature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    // 3. Dedup — return success on replay so Resend stops retrying, but
    //    skip side effects.
    const payload = this.parsePayload(raw);
    const dedup = await this.processed.recordInboundEvent(RESEND_PROVIDER, svixId, {
      type: payload.type,
      email_id: payload.data.email_id ?? null,
    });
    if (dedup.alreadyProcessed) {
      this.logger.log(`replay: svixId=${svixId} type=${payload.type}`);
      return { ok: true, replay: true };
    }

    // 4. Branch on event type.
    await this.handleEvent(payload);

    this.logger.log(
      `processed: svixId=${svixId} type=${payload.type} emailId=${payload.data.email_id ?? '-'}`,
    );
    return { ok: true, replay: false };
  }

  // ── Signature verification ────────────────────────────────────────────────

  private verifySignature(
    secret: string,
    svixId: string,
    svixTimestamp: string,
    rawBody: string,
    headerValue: string,
  ): boolean {
    const key = this.decodeSecret(secret);
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const expected = createHmac('sha256', key).update(signedContent).digest('base64');
    const expectedBuf = Buffer.from(expected, 'utf8');

    // Header is "v1,sigA v1,sigB" — accept if any matches.
    return headerValue.split(' ').some((part) => {
      const idx = part.indexOf(',');
      if (idx < 0) return false;
      const version = part.slice(0, idx);
      const sig = part.slice(idx + 1);
      if (version !== 'v1') return false;
      const sigBuf = Buffer.from(sig, 'utf8');
      if (sigBuf.length !== expectedBuf.length) return false;
      try {
        return timingSafeEqual(sigBuf, expectedBuf);
      } catch {
        return false;
      }
    });
  }

  private decodeSecret(secret: string): Buffer {
    const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
    try {
      return Buffer.from(raw, 'base64');
    } catch {
      // Fall back to utf8 — accept manually-set non-base64 secrets in tests.
      return Buffer.from(raw, 'utf8');
    }
  }

  private parsePayload(raw: string): ResendWebhookEvent {
    try {
      return JSON.parse(raw) as ResendWebhookEvent;
    } catch {
      throw new UnauthorizedException('Invalid JSON body');
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private async handleEvent(event: ResendWebhookEvent): Promise<void> {
    const emailId = event.data.email_id;
    const log = emailId ? await this.findLogByProviderId(emailId) : null;

    switch (event.type) {
      case 'email.sent':
        if (log) await this.setStatus(log.id, 'sent', { providerMessageId: emailId ?? undefined });
        break;
      case 'email.delivered':
        if (log) await this.setStatus(log.id, 'delivered', {});
        break;
      case 'email.bounced': {
        const bounceType = event.data.bounce?.type ?? 'soft';
        if (log) {
          await this.setStatus(log.id, 'bounced', {
            bounce: event.data.bounce ?? {},
          });
        }
        if (bounceType === 'hard') {
          const to = this.recipient(event);
          if (to) {
            await this.suppression.suppress(to, 'bounce.hard', 'resend');
            await this.flagUserDeliverability(to, 'bounced');
          }
        }
        break;
      }
      case 'email.complained': {
        if (log) await this.setStatus(log.id, 'complained', { complaint: true });
        const to = this.recipient(event);
        if (to) {
          await this.suppression.suppress(to, 'complaint', 'resend');
          await this.flagUserDeliverability(to, 'complained');
        }
        break;
      }
      case 'email.opened':
        if (log) await this.appendOpenedAt(log.id);
        break;
      default:
        this.logger.warn(`Unhandled event type: ${event.type}`);
    }
  }

  private recipient(event: ResendWebhookEvent): string | null {
    const to = event.data.to;
    if (typeof to === 'string') return to.trim().toLowerCase();
    if (Array.isArray(to) && to.length > 0) return String(to[0]).trim().toLowerCase();
    return null;
  }

  private async findLogByProviderId(
    providerMessageId: string,
  ): Promise<{ id: string; metadata: unknown } | null> {
    // metadata.providerMessageId is the join key (set in mail.processor).
    // Served by the btree expression index "NotificationLog_providerMessageId_idx"
    // on (metadata->>'providerMessageId') — the Prisma { path, equals } filter
    // below compiles to that scalar text equality (NE8, plan Risk R7).
    const rows = await this.prisma.notificationLog.findMany({
      where: {
        metadata: { path: ['providerMessageId'], equals: providerMessageId },
      },
      orderBy: { sentAt: 'desc' },
      take: 1,
      select: { id: true, metadata: true },
    });
    return rows[0] ?? null;
  }

  private async setStatus(
    logId: string,
    status: 'sent' | 'delivered' | 'bounced' | 'complained',
    extraMetadata: Record<string, unknown>,
  ): Promise<void> {
    const log = await this.prisma.notificationLog.findUnique({
      where: { id: logId },
      select: { metadata: true },
    });
    const prev = (log?.metadata as Record<string, unknown> | null) ?? {};
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status,
        metadata: { ...prev, ...extraMetadata, lastEventAt: new Date().toISOString() },
      },
    });
  }

  private async appendOpenedAt(logId: string): Promise<void> {
    const log = await this.prisma.notificationLog.findUnique({
      where: { id: logId },
      select: { metadata: true },
    });
    const prev = (log?.metadata as Record<string, unknown> | null) ?? {};
    const openedAt = Array.isArray(prev.openedAt) ? (prev.openedAt as string[]) : [];
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: { metadata: { ...prev, openedAt: [...openedAt, new Date().toISOString()] } },
    });
  }

  private async flagUserDeliverability(
    email: string,
    state: 'bounced' | 'complained',
  ): Promise<void> {
    const data: Record<string, unknown> = { emailDeliverability: state };
    if (state === 'bounced') data.emailBouncedAt = new Date();
    if (state === 'complained') data.emailComplainedAt = new Date();
    await this.prisma.user.updateMany({ where: { email }, data });
  }
}
