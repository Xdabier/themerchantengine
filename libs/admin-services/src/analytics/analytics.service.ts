import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  type AnalyticsDateQuery,
  analyticsDateQuerySchema,
  type CustomerAnalyticsResponse,
  customerAnalyticsResponseSchema,
  type DashboardSummary,
  dashboardSummarySchema,
  type FunnelResponse,
  funnelResponseSchema,
  type PixelConfig,
  pixelConfigSchema,
  type ProductAnalyticsResponse,
  productAnalyticsResponseSchema,
  type RevenueAnalyticsResponse,
  revenueAnalyticsResponseSchema,
  type SearchAnalyticsResponse,
  searchAnalyticsResponseSchema,
  type TimeseriesQuery,
  type TimeseriesResponse,
  timeseriesQuerySchema,
  timeseriesResponseSchema,
  type UpdatePixelsRequest,
  updatePixelsRequestSchema,
} from './analytics.schemas';
import type { ZodType } from 'zod';

const ANALYTICS = ADMIN_API_ROUTES.analytics;

/** `/v1/admin/analytics/*` — see `apps/api/src/modules/analytics`. */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /** GET /v1/admin/analytics/dashboard */
  dashboard(): Observable<DashboardSummary> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.dashboard)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => dashboardSummarySchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/analytics/funnel */
  funnel(query: AnalyticsDateQuery = {}): Observable<FunnelResponse> {
    return this.get(
      `${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.funnel)}`,
      query,
      funnelResponseSchema,
    );
  }

  /** GET /v1/admin/analytics/products */
  products(query: AnalyticsDateQuery = {}): Observable<ProductAnalyticsResponse> {
    return this.get(
      `${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.products)}`,
      query,
      productAnalyticsResponseSchema,
    );
  }

  /** GET /v1/admin/analytics/revenue */
  revenue(query: AnalyticsDateQuery = {}): Observable<RevenueAnalyticsResponse> {
    return this.get(
      `${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.revenue)}`,
      query,
      revenueAnalyticsResponseSchema,
    );
  }

  /** GET /v1/admin/analytics/customers */
  customers(query: AnalyticsDateQuery = {}): Observable<CustomerAnalyticsResponse> {
    return this.get(
      `${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.customers)}`,
      query,
      customerAnalyticsResponseSchema,
    );
  }

  /** GET /v1/admin/analytics/search */
  search(query: AnalyticsDateQuery = {}): Observable<SearchAnalyticsResponse> {
    return this.get(
      `${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.search)}`,
      query,
      searchAnalyticsResponseSchema,
    );
  }

  /** GET /v1/admin/analytics/timeseries — bucketed metric series for charts. */
  timeseries(query: TimeseriesQuery): Observable<TimeseriesResponse> {
    const parsed = timeseriesQuerySchema.parse(query);
    const params = new HttpParams({
      fromObject: toParams(parsed as Record<string, unknown> as never),
    });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.timeseries)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => timeseriesResponseSchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/analytics/pixels */
  getPixels(): Observable<PixelConfig> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.pixels)}`, {
        withCredentials: true,
      })
      .pipe(
        map((raw) => {
          // Handler wraps service result in `{ data }` manually; double-unwrap
          // if the envelope interceptor runs on top.
          const first = envelope<unknown>(raw);
          const second = envelope<unknown>(first);
          return pixelConfigSchema.parse(second);
        }),
      );
  }

  /** PATCH /v1/admin/analytics/pixels */
  updatePixels(input: UpdatePixelsRequest): Observable<PixelConfig> {
    const body = updatePixelsRequestSchema.parse(input);
    return this.http
      .patch<unknown>(`${this.apiBase}/${adminRoute(ANALYTICS.base, ANALYTICS.pixels)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => pixelConfigSchema.parse(envelope(envelope<unknown>(raw)))));
  }

  private get<T>(url: string, query: AnalyticsDateQuery, schema: ZodType<T>): Observable<T> {
    const parsed = analyticsDateQuerySchema.parse(query);
    const params = new HttpParams({
      fromObject: toParams(parsed as Record<string, unknown> as never),
    });
    return this.http
      .get<unknown>(url, { params, withCredentials: true })
      .pipe(map((raw) => schema.parse(envelope(raw))));
  }
}
