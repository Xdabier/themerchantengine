import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  createRedirectRequestSchema,
  type CreateRedirectRequest,
  listRedirectsQuerySchema,
  type ListRedirectsQuery,
  listRedirectsResponseSchema,
  type ListRedirectsResponse,
  redirectSchema,
  type Redirect,
  listSeoSubmissionsQuerySchema,
  type ListSeoSubmissionsQuery,
  listSeoSubmissionsResponseSchema,
  type ListSeoSubmissionsResponse,
  submitSeoRequestSchema,
  type SubmitSeoRequest,
  submitSeoResponseSchema,
  type SubmitSeoResponse,
  seoCoverageSchema,
  type SeoCoverage,
  seoQuotaSchema,
  type SeoQuota,
  seoAnalyticsSchema,
  type SeoAnalytics,
  type SeoAnalyticsRange,
  seoUrlInspectionSchema,
  type SeoUrlInspection,
  submissionHealthSchema,
  type SubmissionHealth,
} from './seo.schemas';

const SEO = ADMIN_API_ROUTES.seo;

/** `/v1/admin/seo/*` — redirects + SEO health. */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listRedirects(query: ListRedirectsQuery = {}): Observable<ListRedirectsResponse> {
    const parsed = listRedirectsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.redirects)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listRedirectsResponseSchema.parse(raw)));
  }

  createRedirect(input: CreateRedirectRequest): Observable<Redirect> {
    const body = createRedirectRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.redirects)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => redirectSchema.parse(envelope(raw))));
  }

  deleteRedirect(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(SEO.base, fillRoute(SEO.redirectById, { id }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }

  /** GET /v1/admin/seo/health */
  health(): Observable<unknown> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.health)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => envelope(raw)));
  }

  /** GET /v1/admin/seo/submissions — durable submission audit history (DR-17). */
  listSubmissions(query: ListSeoSubmissionsQuery = {}): Observable<ListSeoSubmissionsResponse> {
    const parsed = listSeoSubmissionsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.submissions)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listSeoSubmissionsResponseSchema.parse(raw)));
  }

  /**
   * POST /v1/admin/seo/submit — manual reindex (DR-17 D2). Validates the target
   * client-side (exactly one of url/productIds/sitemap), sends a fresh UUID v4
   * `X-Idempotency-Key` per call so a double-click never double-burns quota, and
   * parses the per-engine result envelope.
   */
  submitManual(input: SubmitSeoRequest): Observable<SubmitSeoResponse> {
    const body = submitSeoRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.submit)}`, body, {
        withCredentials: true,
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      })
      .pipe(map((raw) => submitSeoResponseSchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/seo/coverage — per-engine sitemap coverage (DR-17 D3). */
  getCoverage(): Observable<SeoCoverage> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.coverage)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => seoCoverageSchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/seo/quota — Bing / GSC-inspect-budget / IndexNow readout (DR-17 D3). */
  getQuota(): Observable<SeoQuota> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.quota)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => seoQuotaSchema.parse(envelope(raw))));
  }

  /**
   * GET /v1/admin/seo/analytics — GSC Search Analytics rollup (DR-17 D4). Optional
   * `range` (`7d`/`28d`/`90d`, default 28d server-side) selects the lookback
   * window. Read-only, server-cached 6 h; degrades to `state:'disabled'`/`'error'`.
   */
  getAnalytics(range?: SeoAnalyticsRange): Observable<SeoAnalytics> {
    const params = range ? new HttpParams().set('range', range) : undefined;
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.analytics)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => seoAnalyticsSchema.parse(envelope(raw))));
  }

  /**
   * GET /v1/admin/seo/url-inspection — one URL's GSC index state (DR-17 D5). Pass
   * either `url` (an absolute storefront URL) or `productId` (resolved to its public
   * URL server-side, so the admin never needs the storefront base URL) plus an
   * optional `locale`. READ-only, lazy-on-click; the server caches ≥24 h and guards
   * the daily inspect budget — a spent budget returns `state:'exhausted'`, GSC off
   * returns `state:'disabled'`.
   */
  inspectUrl(input: {
    url?: string;
    productId?: string;
    /**
     * Open string. `InspectUrlAdminDto` guards `@IsIn(SUPPORTED_LOCALES)` and
     * that constant is the authority; a second copy of the pair here went stale
     * the moment D2 moved it, leaving this type permitting a value the API
     * rejects and forbidding the one it accepts.
     */
    locale?: string;
  }): Observable<SeoUrlInspection> {
    let params = new HttpParams();
    if (input.url) params = params.set('url', input.url);
    if (input.productId) params = params.set('productId', input.productId);
    if (input.locale) params = params.set('locale', input.locale);
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.urlInspection)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => seoUrlInspectionSchema.parse(envelope(raw))));
  }

  /**
   * POST /v1/admin/seo/health/recheck — the live submission-health probe (DR-17 D3).
   * No `X-Idempotency-Key`: a re-check is naturally retry-safe (it refreshes a
   * snapshot and spends no submission quota) and the route is throttled to 1 / 5 min.
   */
  recheckHealth(): Observable<SubmissionHealth> {
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(SEO.base, SEO.healthRecheck)}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => submissionHealthSchema.parse(envelope(raw))));
  }

  /**
   * GET /v1/admin/seo/health → the `submissionHealth` slice, parsed + nullable.
   * The indexing dashboard's status strip needs only the submission-health
   * snapshot; the full content-gap report is read by the SEO health page.
   */
  getSubmissionHealth(): Observable<SubmissionHealth | null> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEO.base, SEO.health)}`, {
        withCredentials: true,
      })
      .pipe(
        map((raw) => {
          const payload = envelope(raw) as { submissionHealth?: unknown } | null;
          const snapshot = payload?.submissionHealth;
          return snapshot == null ? null : submissionHealthSchema.parse(snapshot);
        }),
      );
  }
}
