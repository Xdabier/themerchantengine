import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import {
  PRODUCT_MUTATED_EVENT,
  type ProductMutatedEventPayload,
  PRODUCT_SLUG_CHANGED_EVENT,
} from '../products/products.constants';
import { CATEGORY_SLUG_CHANGED_EVENT } from '../categories/categories.constants';
import {
  STOREFRONT_SECTION_UPDATED_EVENT,
  type StorefrontSectionUpdatedPayload,
} from '../storefront-config/storefront-config.events';
import { STORE_CONFIG_UPDATED_EVENT } from '../settings/settings.events';
import { StoreLocaleRegistry } from '../settings/store-locale.registry';
import { SearchEngineSubmitService } from '../seo/search-engine-submit.service';
import { SeoSubmissionService } from '../seo/seo-submission.service';
import { SEO_SITEMAP_JOB, SEO_SITEMAP_QUEUE, supportedLocales } from '../seo/seo.constants';

type RegenKind = 'products' | 'categories' | 'pages';

/**
 * Posts to the storefront `/api/_internal/revalidate` endpoint whenever a
 * product or category slug changes (or any product is mutated). The
 * storefront uses these signals to invalidate its SSR HTML cache + the
 * sitemap surface for the affected paths.
 *
 * Fire-and-forget by design — a failed dispatch logs but never throws,
 * so the originating write transaction is never disrupted. Retry on
 * transient failure is delegated to the caller (the storefront polls
 * sitemap freshness on a 6 h cache window per the existing API config).
 *
 * Authentication: `STOREFRONT_REVALIDATE_SECRET` shipped in the
 * `X-Revalidate-Secret` header. Compared timing-safely on the storefront
 * side. Never logged. Deployment must set the secret in the API + the
 * storefront environment to the same value.
 *
 * The `fetchImpl` constructor parameter is `@Optional()` so NestJS skips
 * DI resolution and the listener falls back to `globalThis.fetch`. Unit
 * tests pass a spy directly; production wiring uses `undefined` (the DI
 * container provides nothing for this slot).
 */
@Injectable()
export class RevalidationListener {
  private readonly logger = new Logger(RevalidationListener.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    @InjectQueue(SEO_SITEMAP_QUEUE)
    private readonly seoSitemapQueue: Queue,
    private readonly searchEngineSubmit: SearchEngineSubmitService,
    private readonly seoSubmissions: SeoSubmissionService,
    @Optional() fetchImpl?: typeof fetch,
    @Optional() private readonly locales?: StoreLocaleRegistry,
  ) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  @OnEvent(PRODUCT_SLUG_CHANGED_EVENT, { async: true })
  async onProductSlugChanged(payload: {
    productId: string;
    oldSlug: string;
    newSlug: string;
  }): Promise<void> {
    const paths = [
      ...this.productPaths(payload.oldSlug),
      ...this.productPaths(payload.newSlug),
      ...this.sitemapPaths(),
    ];
    await this.dispatch(paths, 'product.write');
    await this.enqueueRegen('products', PRODUCT_SLUG_CHANGED_EVENT);
    await this.submitProductIndexNow([payload.oldSlug, payload.newSlug]);
  }

  @OnEvent(PRODUCT_MUTATED_EVENT, { async: true })
  async onProductMutated(payload: ProductMutatedEventPayload): Promise<void> {
    // PRODUCT_MUTATED fires on create / publish / live-edit / unpublish / restore /
    // archive. The sitemap always regenerates; IndexNow is submitted only when the
    // service flagged the mutation as visibility-relevant — i.e. publishing, editing a
    // live product, or removing one that was public ([DR-15] + ProductMutatedEventPayload).
    // The slug travels on the payload, so no cross-module DB read is needed here.
    await this.dispatch(this.sitemapPaths(), 'product.write');
    await this.enqueueRegen('products', PRODUCT_MUTATED_EVENT);
    if (payload?.shouldSubmitIndexNow && payload.slug) {
      await this.submitProductIndexNow([payload.slug]);
    }
  }

  @OnEvent(CATEGORY_SLUG_CHANGED_EVENT, { async: true })
  async onCategorySlugChanged(payload: {
    categoryId: string;
    oldSlug: string;
    newSlug: string;
  }): Promise<void> {
    const paths = [
      ...this.categoryPaths(payload.oldSlug),
      ...this.categoryPaths(payload.newSlug),
      ...this.sitemapPaths(),
    ];
    await this.dispatch(paths, 'category.write');
    await this.enqueueRegen('categories', CATEGORY_SLUG_CHANGED_EVENT);
    await this.submitCategoryIndexNow([payload.oldSlug, payload.newSlug]);
  }

  /**
   * Storefront section mutation: any create / update / delete / reorder /
   * visibility toggle on a `StorefrontSection` for a given page slug. The
   * storefront SSG layer holds per-page HTML caches keyed on `pageSlug`;
   * this dispatch drops the affected localised paths so the next request
   * re-renders with the operator-edited section list.
   */
  @OnEvent(STOREFRONT_SECTION_UPDATED_EVENT, { async: true })
  async onStorefrontSectionUpdated(payload: StorefrontSectionUpdatedPayload): Promise<void> {
    await this.dispatch(this.pagePaths(payload.pageSlug), 'cms.write');
    await this.enqueueRegen('pages', STOREFRONT_SECTION_UPDATED_EVENT);
    await this.submitPageIndexNow(payload.pageSlug);
  }

  /**
   * Runtime store config write (plan E1.2): the store name, logo, palette,
   * locale set and money format render on every page, so the localised roots
   * are dropped along with `llms.txt`, whose description comes from the
   * config. No sitemap regen: the URL surface does not move.
   */
  @OnEvent(STORE_CONFIG_UPDATED_EVENT, { async: true })
  async onStoreConfigUpdated(): Promise<void> {
    // Nest does not order handlers of one event: refresh the locale set here
    // so a locale enabled by this very write is in the paths that follow.
    await this.locales?.refresh();
    await this.dispatch([...this.localePaths('/'), '/llms.txt'], 'config.write');
  }

  // ── S24.9 sitemap regen + IndexNow side effects per DR-10 ──────────────────

  /**
   * Enqueues a sitemap regen job on every product / category / cms-page
   * mutation event per DR-10 line 55. Deterministic jobId keyed on kind so
   * concurrent enqueues dedupe to one regen per kind per BullMQ debounce
   * window — the existing 6 h cron + the burst-collapse the queue
   * provides for free.
   */
  private async enqueueRegen(kind: RegenKind, triggeredBy: string): Promise<void> {
    try {
      const jobId = `regen-${kind}`;
      await this.seoSitemapQueue.add(
        SEO_SITEMAP_JOB,
        { kind, triggeredBy },
        { jobId, removeOnComplete: true, removeOnFail: false },
      );
    } catch (err) {
      this.logger.warn(
        `enqueueRegen: failed kind=${kind} triggeredBy=${triggeredBy} err=${(err as Error).message}`,
      );
    }
  }

  private async submitProductIndexNow(slugs: string[]): Promise<void> {
    const siteUrl = this.siteUrl();
    if (!siteUrl) return;
    const urls = slugs.flatMap((slug) => this.productPaths(slug).map((p) => `${siteUrl}${p}`));
    const result = await this.searchEngineSubmit.submitToIndexNow(urls, siteUrl);
    await this.seoSubmissions.recordEngineResult({
      trigger: 'auto-regen',
      targetType: 'url',
      targetRef: `product:${slugs.join(',')}`,
      engine: 'indexnow',
      requestedCount: urls.length,
      result,
    });
  }

  private async submitCategoryIndexNow(slugs: string[]): Promise<void> {
    const siteUrl = this.siteUrl();
    if (!siteUrl) return;
    const urls = slugs.flatMap((slug) => this.categoryPaths(slug).map((p) => `${siteUrl}${p}`));
    const result = await this.searchEngineSubmit.submitToIndexNow(urls, siteUrl);
    await this.seoSubmissions.recordEngineResult({
      trigger: 'auto-regen',
      targetType: 'url',
      targetRef: `category:${slugs.join(',')}`,
      engine: 'indexnow',
      requestedCount: urls.length,
      result,
    });
  }

  private async submitPageIndexNow(pageSlug: string): Promise<void> {
    const siteUrl = this.siteUrl();
    if (!siteUrl) return;
    const urls = this.pagePaths(pageSlug).map((p) => `${siteUrl}${p}`);
    const result = await this.searchEngineSubmit.submitToIndexNow(urls, siteUrl);
    await this.seoSubmissions.recordEngineResult({
      trigger: 'auto-regen',
      targetType: 'url',
      targetRef: `page:${pageSlug}`,
      engine: 'indexnow',
      requestedCount: urls.length,
      result,
    });
  }

  private siteUrl(): string | undefined {
    return (
      process.env.STOREFRONT_PUBLIC_BASE_URL ??
      process.env.SITE_URL ??
      process.env.STOREFRONT_REVALIDATE_URL_BASE
    );
  }

  /**
   * Fans a storefront path out across every supported locale.
   *
   * Derived from `supportedLocales()` rather than written as a literal pair:
   * these paths drive both the SSR cache invalidation and the IndexNow push,
   * so a locale that is missing here is a page that silently serves stale HTML
   * and never gets re-submitted to a crawler.
   */
  private localePaths(suffix: string): string[] {
    return supportedLocales().map((locale) => `/${locale}${suffix}`);
  }

  private productPaths(slug: string): string[] {
    return this.localePaths(`/catalog/product/${slug}`);
  }

  private categoryPaths(slug: string): string[] {
    return this.localePaths(`/catalog/${slug}`);
  }

  private sitemapPaths(): string[] {
    return ['/sitemap_index.xml', '/sitemap-products.xml', '/sitemap-categories.xml', '/llms.txt'];
  }

  /**
   * Resolves a section's `pageSlug` to the localised storefront URLs that
   * render it. The home slug renders at `/` per locale; other slugs map
   * straight through. Sitemap paths are deliberately omitted, because section
   * mutations only change in-page HTML, not the URL surface.
   */
  private pagePaths(pageSlug: string): string[] {
    if (pageSlug === 'home') {
      return this.localePaths('/');
    }
    return this.localePaths(`/${pageSlug}`);
  }

  private async dispatch(
    paths: string[],
    reason: 'product.write' | 'category.write' | 'cms.write' | 'config.write',
  ): Promise<void> {
    const url = process.env['STOREFRONT_REVALIDATE_URL'];
    const secret = process.env['STOREFRONT_REVALIDATE_SECRET'];
    if (!url || !secret) {
      // Treat missing config as opt-out — log once at debug level. The
      // dispatcher must not throw or block the originating write.
      this.logger.debug(
        `dispatch: storefront revalidate not configured; skipping reason=${reason} paths=${paths.length}`,
      );
      return;
    }

    const eventId = randomUUID();
    const body = { paths, reason, eventId };

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Revalidate-Secret': secret,
          'X-Request-Id': eventId,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        this.logger.warn(
          `dispatch: storefront returned ${response.status} for reason=${reason} eventId=${eventId} paths=${paths.length}`,
        );
        return;
      }
      this.logger.log(`dispatch: ok reason=${reason} eventId=${eventId} paths=${paths.length}`);
    } catch (err) {
      // Fire-and-forget. Log + swallow so the originating write is
      // never disrupted. Never echo the secret.
      this.logger.error(
        `dispatch: failed reason=${reason} eventId=${eventId} paths=${paths.length}`,
        (err as Error).stack,
      );
    }
  }
}
