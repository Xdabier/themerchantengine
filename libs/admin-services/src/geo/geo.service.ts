import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import {
  acceptFaqsRequestSchema,
  type AcceptFaqsRequest,
  acceptFaqsResponseSchema,
  type AcceptFaqsResponse,
  aiReadinessReportSchema,
  type AiReadinessReport,
  faqSuggestionsResponseSchema,
  type FaqSuggestionsResponse,
} from './geo.schemas';

const GEO = ADMIN_API_ROUTES.geo;

/**
 * `/v1/admin/geo/*` — AI readiness scoring and FAQ suggestion workflow.
 *
 * The FAQ-accept endpoint is idempotent: the backend no-ops when the product
 * already has FAQs, so re-submitting is safe from the UI.
 */
@Injectable({ providedIn: 'root' })
export class GeoService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  getAiReadiness(): Observable<AiReadinessReport> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(GEO.base, GEO.aiReadiness)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => aiReadinessReportSchema.parse(envelope(raw))));
  }

  getFaqSuggestions(productId: string): Observable<FaqSuggestionsResponse> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(GEO.base, fillRoute(GEO.faqSuggestions, { productId }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => faqSuggestionsResponseSchema.parse(raw)));
  }

  acceptFaqSuggestions(
    productId: string,
    input: AcceptFaqsRequest,
  ): Observable<AcceptFaqsResponse> {
    let body: AcceptFaqsRequest;
    try {
      body = acceptFaqsRequestSchema.parse(input);
    } catch (err) {
      return throwError(() => err);
    }
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(GEO.base, fillRoute(GEO.faqAccept, { productId }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => acceptFaqsResponseSchema.parse(raw)));
  }
}
