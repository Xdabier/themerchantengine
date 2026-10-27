/**
 * EmailSuppression read/write port.
 *
 * Read-side: MailService consults `isSuppressed(email)` before every enqueue
 * to short-circuit known-bad addresses (saves quota + protects domain
 * reputation per Resend's bounce/complaint guidance).
 *
 * Write-side: the Resend webhook listener calls `suppress(...)` on
 * `email.complained` (always) and on `email.bounced` with `bounce.type=hard`.
 * Operators can also `suppress(..., 'operator.manual')` via admin tooling.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SuppressionReason = 'bounce.hard' | 'complaint' | 'operator.manual';
export type SuppressionSource = 'resend' | 'manual';

@Injectable()
export class SuppressionService {
  private readonly logger = new Logger(SuppressionService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Returns true when the address has a row in EmailSuppression. */
  async isSuppressed(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const row = await this.prisma.emailSuppression.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    return Boolean(row);
  }

  /**
   * Upserts a suppression row. Safe to call multiple times for the same
   * email — the first inserted reason wins (we don't overwrite reason or
   * source on a second hit). Use for both Resend events and manual operator
   * triage.
   *
   * NE7 (Risk R8): `unsuppress()` now soft-deletes, so a previously-unsuppressed
   * address that bounces/complains again still has a row (with `deletedAt` set).
   * `upsert` is NOT touched by the soft-delete middleware, so it finds that row
   * by the unique `email` — we clear `deletedAt` to REVIVE the suppression
   * (keeping the original reason/source). A brand-new address inserts fresh.
   */
  async suppress(
    email: string,
    reason: SuppressionReason,
    source: SuppressionSource,
  ): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.prisma.emailSuppression.upsert({
      where: { email: normalized },
      update: { deletedAt: null },
      create: { email: normalized, reason, source },
    });
    this.logger.log(`suppress: email=${normalized} reason=${reason} source=${source}`);
  }

  /**
   * Operator-only — lift a suppression (e.g. a customer requests re-engagement).
   * NE7: soft-deletes rather than hard-deleting so the audit trail survives
   * (Risk R8). `EmailSuppression` is a soft-delete model, so `isSuppressed`'s
   * `findUnique` auto-filters the row out once `deletedAt` is set.
   */
  async unsuppress(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.prisma.emailSuppression.updateMany({
      where: { email: normalized, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`unsuppress: email=${normalized}`);
  }
}
