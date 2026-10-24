/**
 * The single event→email bridge (NE4).
 *
 * Replaces the per-domain OrderMailListener + GiftcardMailListener with one
 * data-driven listener bound to the DISPATCH_TABLE. Each table row registers
 * exactly one EventEmitter2 listener (explicit per-event binding — deliberately
 * NOT an `@OnEvent('**')` wildcard, which plan §3c rejects as noisy). The
 * injected EventEmitter2 is the same global singleton the domain services emit
 * on (EventEmitterModule.forRoot() in app.module.ts), and registration runs at
 * bootstrap (onModuleInit) before any event can fire.
 *
 * dispatch() is the shared boilerplate every present and future flow crosses:
 * resolve recipient/locale/variables, derive a stable dedup key, enqueue, and —
 * on any failure — write an `enqueue-failed` audit row so a dropped email is
 * never silent (Risk R10). It NEVER rethrows: a mail-bridge failure must not
 * block the originating domain mutation.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { stableDedupeKey } from './dedupe.util';
import { DISPATCH_TABLE } from './dispatch.table';
import type { DispatchContext, DispatchEntry, DispatchResolution } from './dispatch.types';

@Injectable()
export class MailDispatchListener implements OnModuleInit {
  private readonly logger = new Logger(MailDispatchListener.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    for (const entry of DISPATCH_TABLE) {
      this.emitter.on(entry.event, (payload: unknown) => this.dispatch(entry, payload), {
        async: true,
      });
    }
    this.logger.log(`bound ${DISPATCH_TABLE.length} dispatch-table events`);
  }

  /** Shared resolve → dedupe → enqueue with a guaranteed audit trail on failure. */
  async dispatch(entry: DispatchEntry, payload: unknown): Promise<void> {
    const ctx: DispatchContext = { prisma: this.prisma, config: this.config };
    let resolution: DispatchResolution | null = null;
    try {
      resolution = await entry.resolve(payload, ctx);
      if (!resolution) return; // resolver opted to skip (no recipient / N/A)

      const dedupeKey = resolution.dedupeId
        ? stableDedupeKey(entry.event, resolution.dedupeId, entry.template)
        : undefined;

      await this.mail.enqueue(entry.template, {
        to: resolution.to,
        locale: resolution.locale,
        variables: resolution.variables,
        ...(dedupeKey ? { dedupeKey } : {}),
      });
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`dispatch failed: ${entry.event} → ${entry.template}: ${reason}`);
      // Risk R10 — the audit row is the source of truth; never drop silently.
      await this.mail.recordEnqueueFailure(
        entry.template,
        resolution?.to ?? '(unresolved)',
        reason,
        { event: entry.event },
      );
    }
  }
}
