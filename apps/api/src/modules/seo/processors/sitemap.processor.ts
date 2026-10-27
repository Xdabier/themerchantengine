import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  SEO_PRODUCTS_SERVICE,
  SEO_SITEMAP_CRON,
  SEO_SITEMAP_JOB,
  SEO_SITEMAP_QUEUE,
  SEO_SUBMISSION_HEALTH_CRON,
  SEO_SUBMISSION_HEALTH_JOB,
  SEO_URL_INSPECT_SWEEP_BATCH,
  SEO_URL_INSPECT_SWEEP_CRON,
  SEO_URL_INSPECT_SWEEP_JOB,
  defaultLocale,
  type SeoProductsReader,
} from '../seo.constants';
import { SearchEngineSubmitService } from '../search-engine-submit.service';
import { SeoSubmissionService } from '../seo-submission.service';
import { SeoInsightsService } from '../seo-insights.service';
import { SeoService } from '../seo.service';
import { entityPath, resolvePublicBaseUrl } from '../site-url';

/**
 * BullMQ processor for sitemap generation.
 *
 * Runs every 6 hours via a repeatable cron job registered in onModuleInit.
 * Also triggered ad-hoc by SeoService.enqueueSitemapRegeneration() when
 * a product or category slug changes, and by RevalidationListener event
 * fan-out per S24.9 + DR-10.
 *
 * Sitemap XML is cached in Redis and served by the storefront controller.
 *
 * Post-regen hook: S24.10 + DR-13 — calls
 * SearchEngineSubmitService.submitToGsc(feedpath) after every successful
 * regen. The hook is unconditional in this processor; the env-gating lives
 * inside submitToGsc so the processor stays clean.
 */
@Processor(SEO_SITEMAP_QUEUE)
export class SitemapProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SitemapProcessor.name);

  constructor(
    private readonly seoService: SeoService,
    private readonly config: ConfigService,
    private readonly searchEngineSubmit: SearchEngineSubmitService,
    private readonly seoSubmissions: SeoSubmissionService,
    @InjectQueue(SEO_SITEMAP_QUEUE) private readonly queue: Queue,
    private readonly insights: SeoInsightsService,
    @Inject(SEO_PRODUCTS_SERVICE) private readonly products: SeoProductsReader,
  ) {
    super();
  }

  /** Register the recurring 6-hour cron job when the module starts. */
  async onModuleInit(): Promise<void> {
    await this.queue.add(
      SEO_SITEMAP_JOB,
      {},
      {
        repeat: { pattern: SEO_SITEMAP_CRON },
        jobId: 'sitemap-cron',
      },
    );
    await this.queue.add(
      SEO_SUBMISSION_HEALTH_JOB,
      {},
      { repeat: { pattern: SEO_SUBMISSION_HEALTH_CRON }, jobId: 'submission-health-cron' },
    );
    await this.queue.add(
      SEO_URL_INSPECT_SWEEP_JOB,
      {},
      { repeat: { pattern: SEO_URL_INSPECT_SWEEP_CRON }, jobId: 'url-inspect-sweep-cron' },
    );
    this.logger.log(
      'onModuleInit: sitemap cron (6h) + submission-health cron (daily 06:30) + ' +
        'url-inspect sweep (daily 05:00) registered',
    );
  }

  async process(job: Job): Promise<void> {
    const siteUrl = resolvePublicBaseUrl(this.config);

    if (job.name === SEO_SUBMISSION_HEALTH_JOB) {
      return this.runHealthCheck(siteUrl);
    }

    if (job.name === SEO_URL_INSPECT_SWEEP_JOB) {
      return this.runUrlInspectSweep(siteUrl);
    }

    this.logger.log(`process: regenerating sitemaps (jobId=${job.id})`);
    try {
      await this.seoService.regenerateSitemaps(siteUrl);
      this.logger.log('process: sitemaps regenerated successfully');
    } catch (err) {
      this.logger.error('process: sitemap regeneration failed', (err as Error).stack);
      throw err; // Allow BullMQ to retry per defaultJobOptions
    }

    // Post-regen submission hooks (DR-13 GSC + DR-16 Bing). Both env-gated + fail-open
    // inside the service; these try/catch wrappers guard against future contract drift only.
    // Each real attempt is recorded to the SeoSubmission audit log (DR-17); the
    // service skips env-disabled no-ops so an unconfigured engine doesn't spam the log.
    const feedpath = `${siteUrl}/sitemap_index.xml`;
    // BullMQ assigns repeatable (cron) iterations a runtime id of the form
    // `repeat:<checksum>:<nextMillis>` — NEVER the configured `jobId` — so a
    // `job.id === 'sitemap-cron'` check is dead and every scheduled submit would
    // mislabel as auto-regen. Discriminate on `repeatJobKey` / `opts.repeat`,
    // which are set only on the cron job. Event + ad-hoc regens are non-repeatable.
    const trigger = job.repeatJobKey || job.opts?.repeat ? 'cron' : 'auto-regen';
    try {
      const gsc = await this.searchEngineSubmit.submitToGsc(feedpath);
      if (gsc.accepted) this.logger.log(`process: GSC sitemap submitted feedpath=${feedpath}`);
      await this.seoSubmissions.recordEngineResult({
        trigger,
        targetType: 'sitemap',
        targetRef: feedpath,
        engine: 'gsc',
        requestedCount: 1,
        result: gsc,
        correlationId: job.id,
      });
    } catch (err) {
      this.logger.warn(
        `process: GSC submit hook threw (defensive catch) err=${(err as Error).message}`,
      );
    }
    try {
      const bing = await this.searchEngineSubmit.submitToBing(feedpath);
      if (bing.accepted) this.logger.log(`process: Bing sitemap submitted feedUrl=${feedpath}`);
      await this.seoSubmissions.recordEngineResult({
        trigger,
        targetType: 'sitemap',
        targetRef: feedpath,
        engine: 'bing',
        requestedCount: 1,
        result: bing,
        correlationId: job.id,
      });
    } catch (err) {
      this.logger.warn(
        `process: Bing submit hook threw (defensive catch) err=${(err as Error).message}`,
      );
    }
  }

  /**
   * Daily submission-health probe (DR-16). Asks each enabled engine what it actually has
   * on file (GSC sitemaps.list / Bing GetFeeds) + checks the public sitemap, caches the
   * snapshot for the admin SEO surface, and logs at ERROR when an active path is
   * unhealthy — the regression guard for silent fail-open submission failures (e.g. the
   * GSC creds-permission bug that went undetected because submission fail-opens at WARN).
   */
  private async runHealthCheck(siteUrl: string): Promise<void> {
    try {
      const health = await this.searchEngineSubmit.checkSubmissionHealth(siteUrl);
      await this.seoService.setSubmissionHealth(health);
      const summary = `gsc=${health.gsc.state} bing=${health.bing.state} publicSitemap=${health.publicSitemap.state}`;
      if (health.healthy) {
        this.logger.log(`submission-health: OK (${summary})`);
      } else {
        this.logger.error(
          `submission-health: UNHEALTHY (${summary}) — ` +
            `gsc:${health.gsc.detail} | bing:${health.bing.detail} | public:${health.publicSitemap.detail}`,
        );
      }
    } catch (err) {
      this.logger.error(`submission-health: probe threw err=${(err as Error).message}`);
    }
  }

  /**
   * Slow URL-Inspection cache-warming sweep (DR-17 D5). Inspects the freshest
   * ACTIVE SKUs so an operator opening product-detail gets an instant index-state
   * badge — NOT a new audit trail (inspection is not a submission). Each call goes
   * through the budget-guarded `inspectUrl`, so an already-warm URL costs nothing
   * (cache hit, no spend) and a sweep that hits the daily 2 000/property cap simply
   * stops — the counter is the hard backstop. No-ops entirely when GSC is off.
   */
  private async runUrlInspectSweep(siteUrl: string): Promise<void> {
    if (!this.insights.gscEnabled()) {
      this.logger.log('url-inspect-sweep: GSC disabled — skipping');
      return;
    }
    const products = await this.products.listRecentlyUpdatedActiveSlugs(
      SEO_URL_INSPECT_SWEEP_BATCH,
    );
    const base = siteUrl.replace(/\/$/, '');
    // One representative-locale URL per product keeps the daily spend predictable
    // (1 call/product) — the badge inspects the same default-locale URL on click.
    const locale = defaultLocale();
    let warmed = 0;
    let exhausted = false;
    for (const product of products) {
      const url = `${base}${entityPath('product', product.slug, locale)}`;
      try {
        const result = await this.insights.inspectUrl({ url });
        if (result.state === 'exhausted') {
          exhausted = true;
          break;
        }
        warmed += 1;
      } catch (err) {
        // One bad URL must not abort the sweep — warm the rest.
        this.logger.warn(
          `url-inspect-sweep: inspect threw url=${url} err=${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `url-inspect-sweep: warmed=${warmed}/${products.length}` +
        (exhausted ? ' (daily inspect budget exhausted — stopped early)' : ''),
    );
  }
}
