import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { SearchEngineSubmitResult } from './search-engine-submit.service';
import {
  SEO_SUBMISSION_REASON_MAX,
  SEO_SUBMISSIONS_DEFAULT_PAGE_SIZE,
  type SeoSubmissionEngine,
  type SeoSubmissionTargetType,
  type SeoSubmissionTrigger,
} from './seo.constants';
import type { ListSeoSubmissionsAdminDto } from './dto';

/** Explicit fields a caller records for one engine of one submission attempt. */
export interface RecordSubmissionInput {
  /** Better Auth user id that triggered it; null/undefined for cron / auto-regen. */
  actorId?: string | null;
  trigger: SeoSubmissionTrigger;
  targetType: SeoSubmissionTargetType;
  targetRef: string;
  engine: SeoSubmissionEngine;
  requestedCount: number;
  submittedCount: number;
  skippedDeduped?: number;
  accepted: boolean;
  reason?: string | null;
  correlationId?: string | null;
}

/** Convenience shape for recording straight from a SearchEngineSubmitResult. */
export interface RecordEngineResultInput {
  actorId?: string | null;
  trigger: SeoSubmissionTrigger;
  targetType: SeoSubmissionTargetType;
  targetRef: string;
  engine: SeoSubmissionEngine;
  requestedCount: number;
  result: SearchEngineSubmitResult;
  correlationId?: string | null;
}

/**
 * Durable, append-only audit log of every search-engine submission attempt
 * (DR-17). Writes one row PER ENGINE per attempt — manual, auto-regen, and cron
 * — so a silent fail-open (the DR-16 class) is now queryable. `record()` is
 * fail-soft: a DB hiccup must never break the fire-and-forget submission path it
 * is auditing, so it catches + logs and never throws.
 */
@Injectable()
export class SeoSubmissionService {
  private readonly logger = new Logger(SeoSubmissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one audit row. Fail-soft — never throws into the submit path.
   * Returns the new row id (the `submissionId` the manual-submit response
   * surfaces per engine) or `null` when the best-effort write failed.
   */
  async record(input: RecordSubmissionInput): Promise<string | null> {
    try {
      const row = await this.prisma.seoSubmission.create({
        data: {
          actorId: input.actorId ?? null,
          trigger: input.trigger,
          targetType: input.targetType,
          targetRef: input.targetRef,
          engine: input.engine,
          requestedCount: input.requestedCount,
          submittedCount: input.submittedCount,
          skippedDeduped: input.skippedDeduped ?? 0,
          accepted: input.accepted,
          reason: input.reason ? input.reason.slice(0, SEO_SUBMISSION_REASON_MAX) : null,
          correlationId: input.correlationId ?? null,
        },
      });
      return row.id;
    } catch (err) {
      // Audit write is best-effort; the submission itself already happened.
      this.logger.warn({
        msg: 'SeoSubmission record failed',
        engine: input.engine,
        trigger: input.trigger,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * True when a result is an env-gated no-op (the engine is simply not
   * configured) rather than a real attempt — `{accepted:false, submitted:0}`
   * with a `disabled` / `…unset` reason. Automatic paths skip recording these so
   * the audit log isn't flooded with a `disabled` row on every 6 h cron + every
   * product edit; the disabled state is already shown by the health snapshot.
   */
  private isConfigNoop(result: SearchEngineSubmitResult): boolean {
    if (result.accepted || result.submitted !== 0) return false;
    const reason = result.reason ?? '';
    return reason === 'disabled' || reason.endsWith('unset');
  }

  /**
   * Records from a SearchEngineSubmitResult. For IndexNow, derives the
   * dedup-skip count as `requested − submitted` ONLY on an accepted result (on a
   * rejected/errored result the shortfall is a failure, not a dedup, so it stays
   * 0 and the reason carries the detail). GSC/Bing are per-sitemap (no dedup).
   *
   * Automatic (`auto-regen` / `cron`) submissions to an unconfigured engine are
   * skipped (`isConfigNoop`); a `manual` attempt is ALWAYS recorded so the
   * operator sees the `disabled` outcome they explicitly triggered.
   */
  async recordEngineResult(input: RecordEngineResultInput): Promise<string | null> {
    if (input.trigger !== 'manual' && this.isConfigNoop(input.result)) return null;
    const submittedCount = input.result.submitted;
    const skippedDeduped =
      input.engine === 'indexnow' && input.result.accepted
        ? Math.max(0, input.requestedCount - submittedCount)
        : 0;
    return this.record({
      actorId: input.actorId,
      trigger: input.trigger,
      targetType: input.targetType,
      targetRef: input.targetRef,
      engine: input.engine,
      requestedCount: input.requestedCount,
      submittedCount,
      skippedDeduped,
      accepted: input.result.accepted,
      reason: input.result.reason ?? null,
      correlationId: input.correlationId,
    });
  }

  /** Paginated, filterable submission history for the admin dashboard. */
  async list(dto: ListSeoSubmissionsAdminDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? SEO_SUBMISSIONS_DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;
    const sortBy = dto.sortBy ?? 'createdAt';
    const sortOrder = dto.sortOrder ?? 'desc';

    const where: Prisma.SeoSubmissionWhereInput = {};
    if (dto.engine) where.engine = dto.engine;
    if (dto.trigger) where.trigger = dto.trigger;
    if (dto.targetType) where.targetType = dto.targetType;
    if (dto.accepted !== undefined) where.accepted = dto.accepted;
    if (dto.from || dto.to) {
      where.createdAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.seoSubmission.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.seoSubmission.count({ where }),
    ]);

    return { data: items, meta: { page, pageSize, total } };
  }
}
