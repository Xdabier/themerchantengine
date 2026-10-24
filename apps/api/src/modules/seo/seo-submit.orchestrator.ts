import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from '../../common/idempotency.service';
import {
  IdempotencyKeyConflictException,
  IdempotencyKeyForbiddenException,
} from '../../common/exceptions/idempotency.exception';
import { SearchEngineSubmitService } from './search-engine-submit.service';
import type { SearchEngineSubmitResult } from './search-engine-submit.service';
import { SeoSubmissionService } from './seo-submission.service';
import {
  SEO_PRODUCTS_SERVICE,
  SEO_SUBMIT_IDEMPOTENCY_SCOPE,
  SEO_TARGET_ENGINES,
  type SeoProductsReader,
  type SeoSubmissionEngine,
  type SeoSubmissionTargetType,
} from './seo.constants';

// Re-exported from its single home in seo.constants so existing importers
// (orchestrator spec) keep resolving `SeoProductsReader` from this module.
export type { SeoProductsReader } from './seo.constants';
import { localeProductUrls, resolvePublicBaseUrl } from './site-url';
import type { SubmitSeoAdminDto } from './dto';
import {
  SeoForeignUrlException,
  SeoMultipleTargetsException,
  SeoNoApplicableEngineException,
  SeoNoTargetException,
} from './seo-submit.exceptions';

/** Per-engine outcome surfaced to the admin client. */
export interface SeoSubmitEngineResult {
  engine: SeoSubmissionEngine;
  accepted: boolean;
  submitted: number;
  skippedDeduped: number;
  reason: string | null;
  /** Audit-row id; null on dryRun or a fail-soft audit-write miss. */
  submissionId: string | null;
}

export interface SeoSubmitResponse {
  dryRun: boolean;
  targetType: SeoSubmissionTargetType;
  /** Number of URLs (or 1 for a sitemap) the request resolved to. */
  requestedCount: number;
  results: SeoSubmitEngineResult[];
}

/**
 * Manual reindex orchestrator (DR-17 D2). Resolves a `{url}` / `{productIds}` /
 * `{sitemap}` target to concrete URLs, fans out to the engines applicable to
 * that target (url/products → IndexNow; sitemap → GSC + Bing), records one
 * append-only `SeoSubmission` row per engine with `trigger:'manual'`, and
 * returns the per-engine outcome. Idempotent via the shared `IdempotencyService`
 * so a double-click never double-burns finite crawler quota. Built on the
 * already-shipped fail-open submit methods — it never rebuilds them.
 */
@Injectable()
export class SeoSubmitOrchestrator {
  private readonly logger = new Logger(SeoSubmitOrchestrator.name);

  constructor(
    private readonly submit: SearchEngineSubmitService,
    private readonly submissions: SeoSubmissionService,
    private readonly config: ConfigService,
    private readonly idempotency: IdempotencyService,
    @Inject(SEO_PRODUCTS_SERVICE) private readonly products: SeoProductsReader,
  ) {}

  async submitManual(
    dto: SubmitSeoAdminDto,
    actorId: string,
    idempotencyKey: string,
    correlationId: string | null,
  ): Promise<SeoSubmitResponse> {
    const targetType = this.resolveTargetType(dto);
    const engines = this.resolveEngines(targetType, dto.engines);
    const siteUrl = resolvePublicBaseUrl(this.config);
    const { urls, feedpath, targetRef, requestedCount } = await this.resolveTarget(
      targetType,
      dto,
      siteUrl,
    );

    const dryRun = dto.dryRun === true;

    // dryRun is read-only — no quota spend, no audit rows, nothing to make
    // idempotent — so it skips the Redis claim entirely.
    if (dryRun) {
      return {
        dryRun: true,
        targetType,
        requestedCount,
        results: await this.previewEngines(engines, urls),
      };
    }

    const callerHash = IdempotencyService.sha256Hex(actorId);
    const bodyHash = IdempotencyService.sha256Hex(
      IdempotencyService.stableStringify({
        targetType,
        url: dto.url ?? null,
        productIds: dto.productIds ? [...dto.productIds].sort() : null,
        sitemap: dto.sitemap ?? null,
        engines: [...engines].sort(),
      }),
    );

    const begin = await this.idempotency.beginRequest({
      scope: SEO_SUBMIT_IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      callerHash,
      bodyHash,
    });
    switch (begin.state) {
      case 'cached':
        return begin.cachedResponse as SeoSubmitResponse;
      case 'forbidden':
        throw new IdempotencyKeyForbiddenException();
      case 'conflict':
      case 'in-flight':
        throw new IdempotencyKeyConflictException();
      case 'fresh':
        break;
    }

    try {
      const results = await this.runEngines({
        engines,
        urls,
        feedpath,
        siteUrl,
        targetType,
        targetRef,
        actorId,
        correlationId,
      });
      const response: SeoSubmitResponse = { dryRun: false, targetType, requestedCount, results };
      await this.idempotency.completeRequest({
        scope: SEO_SUBMIT_IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        callerHash,
        bodyHash,
        entityId:
          results.find((r) => r.submissionId)?.submissionId ?? correlationId ?? 'seo-submit',
        responseJson: response,
      });
      return response;
    } catch (err) {
      await this.idempotency.abortRequest({
        scope: SEO_SUBMIT_IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        callerHash,
      });
      throw err;
    }
  }

  // ── Target resolution ─────────────────────────────────────────────────────

  /** Exactly one of url / productIds / sitemap. Runs even when all are absent. */
  private resolveTargetType(dto: SubmitSeoAdminDto): SeoSubmissionTargetType {
    const present = [
      dto.url !== undefined,
      dto.productIds !== undefined,
      dto.sitemap !== undefined,
    ].filter(Boolean).length;
    if (present === 0) throw new SeoNoTargetException();
    if (present > 1) throw new SeoMultipleTargetsException();
    if (dto.url !== undefined) return 'url';
    if (dto.productIds !== undefined) return 'products';
    return 'sitemap';
  }

  /** Narrow the requested engines to the ones applicable to the target type. */
  private resolveEngines(
    targetType: SeoSubmissionTargetType,
    requested?: SeoSubmissionEngine[],
  ): SeoSubmissionEngine[] {
    const applicable = SEO_TARGET_ENGINES[targetType];
    const selected = requested ? applicable.filter((e) => requested.includes(e)) : [...applicable];
    if (selected.length === 0) throw new SeoNoApplicableEngineException();
    return selected;
  }

  private async resolveTarget(
    targetType: SeoSubmissionTargetType,
    dto: SubmitSeoAdminDto,
    siteUrl: string,
  ): Promise<{ urls: string[]; feedpath: string; targetRef: string; requestedCount: number }> {
    if (targetType === 'url') {
      const url = dto.url as string;
      this.assertSameOrigin(url, siteUrl);
      return { urls: [url], feedpath: '', targetRef: url, requestedCount: 1 };
    }
    if (targetType === 'products') {
      const ids = dto.productIds as string[];
      const resolved = await this.products.resolveActivePublicSlugs(ids);
      const urls = resolved.flatMap((p) => localeProductUrls(siteUrl, p.slug));
      const targetRef = `${resolved.length}/${ids.length} product(s)`;
      return { urls, feedpath: '', targetRef, requestedCount: urls.length };
    }
    const feedpath = `${siteUrl}/sitemap_index.xml`;
    return { urls: [], feedpath, targetRef: feedpath, requestedCount: 1 };
  }

  private assertSameOrigin(url: string, siteUrl: string): void {
    let urlOrigin: string;
    let baseOrigin: string;
    try {
      urlOrigin = new URL(url).origin;
      baseOrigin = new URL(siteUrl).origin;
    } catch {
      throw new SeoForeignUrlException();
    }
    if (urlOrigin !== baseOrigin) throw new SeoForeignUrlException();
  }

  // ── Engine fan-out ──────────────────────────────────────────────────────────

  private async previewEngines(
    engines: SeoSubmissionEngine[],
    urls: string[],
  ): Promise<SeoSubmitEngineResult[]> {
    const out: SeoSubmitEngineResult[] = [];
    for (const engine of engines) {
      if (engine === 'indexnow') {
        const { fresh, deduped } = await this.submit.previewIndexNowDedup(urls);
        out.push({
          engine,
          accepted: true,
          submitted: fresh,
          skippedDeduped: deduped,
          reason: 'dry run',
          submissionId: null,
        });
      } else {
        out.push({
          engine,
          accepted: true,
          submitted: 1,
          skippedDeduped: 0,
          reason: 'dry run',
          submissionId: null,
        });
      }
    }
    return out;
  }

  private async runEngines(args: {
    engines: SeoSubmissionEngine[];
    urls: string[];
    feedpath: string;
    siteUrl: string;
    targetType: SeoSubmissionTargetType;
    targetRef: string;
    actorId: string;
    correlationId: string | null;
  }): Promise<SeoSubmitEngineResult[]> {
    const out: SeoSubmitEngineResult[] = [];
    for (const engine of args.engines) {
      const requestedCount = engine === 'indexnow' ? args.urls.length : 1;
      const result = await this.callEngine(engine, args.urls, args.feedpath, args.siteUrl);
      const submissionId = await this.submissions.recordEngineResult({
        actorId: args.actorId,
        trigger: 'manual',
        targetType: args.targetType,
        targetRef: args.targetRef,
        engine,
        requestedCount,
        result,
        correlationId: args.correlationId,
      });
      const skippedDeduped =
        engine === 'indexnow' && result.accepted
          ? Math.max(0, requestedCount - result.submitted)
          : 0;
      out.push({
        engine,
        accepted: result.accepted,
        submitted: result.submitted,
        skippedDeduped,
        reason: result.reason ?? null,
        submissionId,
      });
    }
    return out;
  }

  private callEngine(
    engine: SeoSubmissionEngine,
    urls: string[],
    feedpath: string,
    siteUrl: string,
  ): Promise<SearchEngineSubmitResult> {
    switch (engine) {
      case 'indexnow':
        return this.submit.submitToIndexNow(urls, siteUrl);
      case 'gsc':
        return this.submit.submitToGsc(feedpath);
      case 'bing':
        return this.submit.submitToBing(feedpath);
    }
  }
}
