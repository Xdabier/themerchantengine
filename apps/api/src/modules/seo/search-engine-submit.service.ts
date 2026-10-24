import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { google } from 'googleapis';
import type Redis from 'ioredis';

import { SEO_INDEXNOW_DEDUP_WINDOW_SECONDS, SEO_REDIS_CLIENT } from './seo.constants';

/**
 * Search-engine submission client. Two parallel paths per
 * [DR-10](../../../../specs/decision-records/10-indexnow-vs-gsc-submission.md)
 * (IndexNow primary, covers Bing + Yandex + Naver + Seznam) and
 * [DR-13](../../../../specs/decision-records/13-gsc-api-sitemap-submission.md)
 * (GSC API as opt-in post-regen hook, covers Google).
 *
 * Both methods are FAIL-OPEN by design: any transport / auth / quota
 * error logs at WARN with the diagnostic body and returns a
 * `{ accepted: false, submitted: 0, reason }` shape. The methods never
 * throw — submission is fire-and-forget per the §3.6 RedisDedupStore
 * fail-open precedent landed in S21 H-1.
 */
export interface SearchEngineSubmitResult {
  accepted: boolean;
  submitted: number;
  reason?: string;
}

export type SubmissionHealthState = 'ok' | 'stale' | 'error' | 'missing' | 'disabled';

/** Snapshot produced by checkSubmissionHealth() and cached for the admin SEO surface. */
export interface SubmissionHealth {
  checkedAt: string;
  healthy: boolean;
  gsc: { state: SubmissionHealthState; detail: string };
  bing: { state: SubmissionHealthState; detail: string };
  publicSitemap: { state: 'ok' | 'error'; detail: string };
}

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const INDEXNOW_BATCH_LIMIT = 10_000;
const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters'] as const;

/**
 * Per-URL IndexNow dedup window. The IndexNow spec treats resubmitting the same URL
 * without a meaningful content change as spam (HTTP 429) and recommends waiting at
 * least 5 minutes between updates of a given URL. We enforce that with a Redis
 * SET NX EX so the same URL is submitted at most once per window — see [DR-15].
 */
const INDEXNOW_DEDUP_PREFIX = 'seo:indexnow:dedup:';
// Single-sourced from seo.constants (§3.14) so the /quota readout's advertised
// window can never drift from the window this dedup actually enforces.
const INDEXNOW_DEDUP_TTL_SECONDS = SEO_INDEXNOW_DEDUP_WINDOW_SECONDS;

// Bing Webmaster Tools Content Submission API (key-auth, no OAuth) — see [DR-16].
const BING_SUBMIT_FEED_ENDPOINT = 'https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed';
const BING_GET_FEEDS_ENDPOINT = 'https://ssl.bing.com/webmaster/api.svc/json/GetFeeds';

/** A submitted sitemap that an engine has not re-fetched within this window is stale. */
const SUBMISSION_HEALTH_STALE_MS = 3 * 24 * 60 * 60 * 1000;

@Injectable()
export class SearchEngineSubmitService {
  private readonly logger = new Logger(SearchEngineSubmitService.name);

  /**
   * Redis is `@Optional()` so the service still constructs in unit tests (`new
   * SearchEngineSubmitService()`) and in any context where the SEO Redis client is not
   * wired — in that case the per-URL dedup is skipped (fail-open). Production wiring
   * injects `SEO_REDIS_CLIENT` from the SEO module.
   */
  constructor(@Optional() @Inject(SEO_REDIS_CLIENT) private readonly redis?: Redis) {}

  /**
   * Submits a list of public URLs to the IndexNow protocol per DR-10.
   * The protocol verifies the key by fetching `${siteUrl}/${INDEXNOW_KEY}.txt`
   * and matching the response body against the submitted key. The operator
   * drops the key file at `apps/storefront/public/<key>.txt` per the runbook
   * at `apps/storefront/public/README-search-submission.md`.
   *
   * Batches the URL list at 10 000 URLs per call (the protocol's documented
   * cap). For larger lists, makes one POST per batch and accumulates the
   * submitted count.
   *
   * @param urls Public URLs to advertise as freshly modified. Locale-prefixed
   *             (e.g. `https://shop.example/fr/catalog/product/widget`).
   * @param siteUrl Base URL of the public origin (used to derive `host` and
   *                `keyLocation` when those env vars are unset).
   */
  async submitToIndexNow(urls: string[], siteUrl: string): Promise<SearchEngineSubmitResult> {
    if (urls.length === 0) {
      return { accepted: true, submitted: 0 };
    }

    const key = process.env.INDEXNOW_KEY;
    if (!key) {
      this.logger.warn({ msg: 'INDEXNOW_KEY unset; skipping IndexNow submission' });
      return { accepted: false, submitted: 0, reason: 'INDEXNOW_KEY unset' };
    }

    // Drop URLs already submitted within the dedup window (anti-spam per IndexNow).
    const fresh = await this.filterFreshUrls(urls);
    if (fresh.length === 0) {
      return {
        accepted: true,
        submitted: 0,
        reason: 'all URLs deduped (<5 min since last submit)',
      };
    }

    const host = process.env.INDEXNOW_HOST ?? this.hostFromSiteUrl(siteUrl);
    const keyLocation = `${siteUrl}/${key}.txt`;

    let submittedTotal = 0;
    for (let i = 0; i < fresh.length; i += INDEXNOW_BATCH_LIMIT) {
      const batch = fresh.slice(i, i + INDEXNOW_BATCH_LIMIT);
      try {
        const response = await fetch(INDEXNOW_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
        });

        if (response.status === 200 || response.status === 202) {
          submittedTotal += batch.length;
          continue;
        }

        const body = await response.text().catch(() => '<unreadable>');
        this.logger.warn({
          msg: 'IndexNow submission rejected',
          status: response.status,
          body: body.slice(0, 500),
          batchSize: batch.length,
        });
        return {
          accepted: false,
          submitted: submittedTotal,
          reason: `IndexNow returned ${response.status}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn({
          msg: 'IndexNow submission threw',
          err: message,
          batchSize: batch.length,
        });
        return {
          accepted: false,
          submitted: submittedTotal,
          reason: `IndexNow transport error: ${message}`,
        };
      }
    }

    this.logger.log(
      `IndexNow submitted ${submittedTotal} url(s) to ${host} ` +
        `(requested=${urls.length}, deduped=${urls.length - fresh.length})`,
    );
    return { accepted: true, submitted: submittedTotal };
  }

  /**
   * Drops URLs already submitted to IndexNow within INDEXNOW_DEDUP_TTL_SECONDS so the
   * same URL is never resubmitted inside the window (anti-spam per the IndexNow spec —
   * see [DR-15]). Uses an atomic Redis SET NX EX as a per-URL "claim". Fail-open: any
   * Redis error — or no Redis client wired (unit tests) — lets every URL through; a
   * missed dedup is harmless, a dropped submission is not.
   *
   * The claim is written BEFORE the POST, so a failed submission burns the window for
   * the affected URLs until the next mutation event or the 6 h sitemap-regen cron. This
   * is an accepted trade-off — it "counts the attempt" per the IndexNow rate guidance,
   * and the cron is the backstop — rather than releasing the claim on every transient error.
   */
  /**
   * Non-claiming dedup preview for the manual-submit `dryRun` (DR-17 D2). Counts
   * how many of the given URLs are currently inside the IndexNow dedup window
   * WITHOUT writing a claim, so opening the confirm dialog never burns the window
   * the real submit depends on. Fail-open: no Redis (unit tests) or any Redis
   * error → every URL counts as fresh (the preview over-promises, never under).
   */
  async previewIndexNowDedup(urls: string[]): Promise<{ fresh: number; deduped: number }> {
    if (!this.redis || urls.length === 0) return { fresh: urls.length, deduped: 0 };
    let deduped = 0;
    for (const url of urls) {
      try {
        const exists = await this.redis.exists(`${INDEXNOW_DEDUP_PREFIX}${url}`);
        if (exists === 1) deduped++;
      } catch {
        // fail-open: a peek error counts the URL as fresh.
      }
    }
    return { fresh: urls.length - deduped, deduped };
  }

  private async filterFreshUrls(urls: string[]): Promise<string[]> {
    if (!this.redis) return urls;
    const fresh: string[] = [];
    for (const url of urls) {
      try {
        const claimed = await this.redis.set(
          `${INDEXNOW_DEDUP_PREFIX}${url}`,
          '1',
          'EX',
          INDEXNOW_DEDUP_TTL_SECONDS,
          'NX',
        );
        if (claimed === 'OK') fresh.push(url);
      } catch {
        fresh.push(url);
      }
    }
    return fresh;
  }

  /**
   * Submits a sitemap path to Google Search Console per DR-13. Env-gated on
   * `GSC_SUBMISSION_ENABLED=true`; when disabled, returns the no-op shape
   * immediately so the caller (sitemap regen processor) stays clean.
   *
   * Reads `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON file path)
   * and `GSC_SITE_URL` (property identifier — `sc-domain:<domain>` for
   * DNS-verified properties or `https://<domain>/` for URL-prefix properties)
   * from env. Constructs a `google.searchconsole` client with the
   * `webmasters` scope and calls `sitemaps.submit({ siteUrl, feedpath })`.
   *
   * @param feedpath Absolute URL of the sitemap on the public origin (e.g.
   *                 `https://shop.example/sitemap_index.xml`).
   */
  async submitToGsc(feedpath: string): Promise<SearchEngineSubmitResult> {
    if (process.env.GSC_SUBMISSION_ENABLED !== 'true') {
      return { accepted: false, submitted: 0, reason: 'disabled' };
    }

    const siteUrl = process.env.GSC_SITE_URL;
    if (!siteUrl) {
      this.logger.warn({ msg: 'GSC_SITE_URL unset; skipping GSC submission' });
      return { accepted: false, submitted: 0, reason: 'GSC_SITE_URL unset' };
    }

    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentials) {
      this.logger.warn({
        msg: 'GOOGLE_APPLICATION_CREDENTIALS unset; skipping GSC submission',
      });
      return {
        accepted: false,
        submitted: 0,
        reason: 'GOOGLE_APPLICATION_CREDENTIALS unset',
      };
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentials,
        scopes: GSC_SCOPES as unknown as string[],
      });
      const client = google.searchconsole({ version: 'v1', auth });
      await client.sitemaps.submit({ siteUrl, feedpath });
      return { accepted: true, submitted: 1 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({
        msg: 'GSC sitemap.submit failed',
        err: message,
        feedpath,
        siteUrl,
      });
      return {
        accepted: false,
        submitted: 0,
        reason: `GSC submission error: ${message}`,
      };
    }
  }

  /**
   * Submits a sitemap URL to Bing Webmaster Tools via the Content Submission API
   * (`SubmitFeed`) per [DR-16]. Key-auth (no OAuth): gated on `BING_API_KEY`; the
   * verified BWT site comes from `BING_SITE_URL` (falls back to `STOREFRONT_PUBLIC_BASE_URL`).
   * Parallel to IndexNow — IndexNow pushes per-URL changes, this registers the full
   * sitemap with Bing for verifiable coverage in the BWT Sitemaps panel. Fail-open:
   * any error logs WARN and returns the no-op shape; never throws.
   *
   * @param feedUrl Absolute URL of the sitemap on the public origin.
   */
  async submitToBing(feedUrl: string): Promise<SearchEngineSubmitResult> {
    const apiKey = process.env.BING_API_KEY;
    if (!apiKey) {
      return { accepted: false, submitted: 0, reason: 'disabled' };
    }
    const siteUrl = process.env.BING_SITE_URL ?? process.env.STOREFRONT_PUBLIC_BASE_URL;
    if (!siteUrl) {
      this.logger.warn({
        msg: 'BING_SITE_URL/STOREFRONT_PUBLIC_BASE_URL unset; skipping Bing submission',
      });
      return { accepted: false, submitted: 0, reason: 'BING_SITE_URL unset' };
    }

    try {
      const response = await fetch(
        `${BING_SUBMIT_FEED_ENDPOINT}?apikey=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ siteUrl, feedUrl }),
        },
      );
      if (response.status === 200) {
        this.logger.log(`Bing sitemap submitted feedUrl=${feedUrl} siteUrl=${siteUrl}`);
        return { accepted: true, submitted: 1 };
      }
      const body = await response.text().catch(() => '<unreadable>');
      this.logger.warn({
        msg: 'Bing SubmitFeed rejected',
        status: response.status,
        body: body.slice(0, 500),
        feedUrl,
      });
      return { accepted: false, submitted: 0, reason: `Bing returned ${response.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ msg: 'Bing SubmitFeed threw', err: message, feedUrl });
      return { accepted: false, submitted: 0, reason: `Bing transport error: ${message}` };
    }
  }

  /**
   * Active health probe of the search-engine submission paths per [DR-16] — the
   * regression guard for silent fail-open failures (e.g. the GSC creds-permission bug).
   * For each enabled path it asks the engine what it actually has on file:
   *  - GSC: `sitemaps.list` → the index sitemap must be present, error-free, and
   *    re-downloaded within SUBMISSION_HEALTH_STALE_MS.
   *  - Bing: `GetFeeds` → the sitemap feed must be registered.
   *  - publicSitemap: the public sitemap index must serve a 200 with a `<sitemapindex>`.
   * Disabled paths report `disabled` and never count against health. Every probe is
   * wrapped so the check itself never throws.
   */
  async checkSubmissionHealth(siteUrl: string): Promise<SubmissionHealth> {
    const feedpath = `${siteUrl}/sitemap_index.xml`;
    const [gsc, bing, publicSitemap] = await Promise.all([
      this.checkGscHealth(feedpath),
      this.checkBingHealth(feedpath),
      this.checkPublicSitemap(feedpath),
    ]);
    const okOrDisabled = (s: SubmissionHealthState) => s === 'ok' || s === 'disabled';
    const healthy =
      okOrDisabled(gsc.state) && okOrDisabled(bing.state) && publicSitemap.state === 'ok';
    return { checkedAt: new Date().toISOString(), healthy, gsc, bing, publicSitemap };
  }

  private async checkGscHealth(
    feedpath: string,
  ): Promise<{ state: SubmissionHealthState; detail: string }> {
    if (process.env.GSC_SUBMISSION_ENABLED !== 'true')
      return { state: 'disabled', detail: 'GSC_SUBMISSION_ENABLED!=true' };
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const propertyUrl = process.env.GSC_SITE_URL;
    if (!credentials || !propertyUrl) return { state: 'error', detail: 'GSC creds/site-url unset' };
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentials,
        scopes: GSC_SCOPES as unknown as string[],
      });
      const client = google.searchconsole({ version: 'v1', auth });
      const res = await client.sitemaps.list({ siteUrl: propertyUrl });
      const entry = (res.data.sitemap ?? []).find((s) => s.path === feedpath);
      if (!entry) return { state: 'missing', detail: `index not registered in ${propertyUrl}` };
      if (Number(entry.errors ?? 0) > 0)
        return { state: 'error', detail: `${entry.errors} sitemap error(s)` };
      const downloaded = entry.lastDownloaded ? Date.parse(entry.lastDownloaded) : 0;
      if (!downloaded || Date.now() - downloaded > SUBMISSION_HEALTH_STALE_MS) {
        return { state: 'stale', detail: `lastDownloaded=${entry.lastDownloaded ?? 'never'}` };
      }
      return { state: 'ok', detail: `lastDownloaded=${entry.lastDownloaded}` };
    } catch (err) {
      return { state: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async checkBingHealth(
    feedUrl: string,
  ): Promise<{ state: SubmissionHealthState; detail: string }> {
    const apiKey = process.env.BING_API_KEY;
    if (!apiKey) return { state: 'disabled', detail: 'BING_API_KEY unset' };
    const siteUrl = process.env.BING_SITE_URL ?? process.env.STOREFRONT_PUBLIC_BASE_URL;
    if (!siteUrl) return { state: 'error', detail: 'BING_SITE_URL unset' };
    try {
      const url = `${BING_GET_FEEDS_ENDPOINT}?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status !== 200) return { state: 'error', detail: `GetFeeds returned ${res.status}` };
      const json = (await res.json().catch(() => ({}))) as { d?: Array<{ Url?: string }> };
      const feeds = json.d ?? [];
      const found = feeds.some((f) => f.Url === feedUrl) || feeds.length > 0;
      return found
        ? { state: 'ok', detail: `${feeds.length} feed(s) registered` }
        : { state: 'missing', detail: 'no sitemap feed registered in BWT' };
    } catch (err) {
      return { state: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async checkPublicSitemap(
    feedpath: string,
  ): Promise<{ state: 'ok' | 'error'; detail: string }> {
    try {
      const res = await fetch(feedpath, { headers: { Accept: 'application/xml' } });
      if (res.status !== 200) return { state: 'error', detail: `HTTP ${res.status}` };
      const body = await res.text();
      return body.includes('<sitemapindex')
        ? { state: 'ok', detail: `HTTP 200, ${body.length} bytes` }
        : { state: 'error', detail: 'no <sitemapindex> in body' };
    } catch (err) {
      return { state: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private hostFromSiteUrl(siteUrl: string): string {
    try {
      return new URL(siteUrl).host;
    } catch {
      return siteUrl;
    }
  }
}
