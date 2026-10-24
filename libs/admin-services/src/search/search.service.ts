import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  analyticsQuerySchema,
  type SearchAnalyticsQuery,
  searchOpsAnalyticsResponseSchema,
  type SearchOpsAnalyticsResponse,
  listZeroResultsResponseSchema,
  type ListZeroResultsResponse,
  reindexResultSchema,
  type ReindexResult,
  createMerchandisingRuleRequestSchema,
  type CreateMerchandisingRuleRequest,
  createSynonymRequestSchema,
  type CreateSynonymRequest,
  listMerchandisingResponseSchema,
  type ListMerchandisingResponse,
  listSynonymsResponseSchema,
  type ListSynonymsResponse,
  merchandisingRuleSchema,
  type MerchandisingRule,
  paginationQuerySchema,
  type PaginationQuery,
  synonymGroupSchema,
  type SynonymGroup,
} from './search.schemas';

const SEARCH = ADMIN_API_ROUTES.search;

/** `/v1/admin/search/*` — search ops and merchandising tools. */
@Injectable({ providedIn: 'root' })
export class SearchAdminService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /** GET /v1/admin/search/analytics */
  analytics(query: SearchAnalyticsQuery = {}): Observable<SearchOpsAnalyticsResponse> {
    const parsed = analyticsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.analytics)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => searchOpsAnalyticsResponseSchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/search/zero-results — paginated, period-windowed. */
  zeroResults(query: SearchAnalyticsQuery = {}): Observable<ListZeroResultsResponse> {
    const parsed = analyticsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.zeroResults)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listZeroResultsResponseSchema.parse(raw)));
  }

  /** POST /v1/admin/search/reindex */
  reindex(): Observable<ReindexResult> {
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.reindex)}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => reindexResultSchema.parse(envelope(raw))));
  }

  /* ── Synonyms ─────────────────────────── */

  listSynonyms(query: PaginationQuery = {}): Observable<ListSynonymsResponse> {
    const parsed = paginationQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.synonyms)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listSynonymsResponseSchema.parse(raw)));
  }

  createSynonym(input: CreateSynonymRequest): Observable<SynonymGroup> {
    const body = createSynonymRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.synonyms)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => synonymGroupSchema.parse(envelope(raw))));
  }

  deleteSynonym(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(SEARCH.base, fillRoute(SEARCH.synonymById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  /* ── Merchandising ────────────────────── */

  listMerchandisingRules(query: PaginationQuery = {}): Observable<ListMerchandisingResponse> {
    const parsed = paginationQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.merchandising)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listMerchandisingResponseSchema.parse(raw)));
  }

  createMerchandisingRule(input: CreateMerchandisingRuleRequest): Observable<MerchandisingRule> {
    const body = createMerchandisingRuleRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(SEARCH.base, SEARCH.merchandising)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => merchandisingRuleSchema.parse(envelope(raw))));
  }

  deleteMerchandisingRule(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(SEARCH.base, fillRoute(SEARCH.merchandisingById, { id }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map(() => undefined));
  }
}
