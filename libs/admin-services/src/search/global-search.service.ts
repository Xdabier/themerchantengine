import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import {
  type GlobalSearchQuery,
  globalSearchQuerySchema,
  type GlobalSearchResult,
  globalSearchResultSchema,
} from './global-search.schemas';

/** `/v1/admin/search` — cross-entity fan-out for the Cmd+K overlay. */
@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  search(query: GlobalSearchQuery): Observable<GlobalSearchResult> {
    const parsed = globalSearchQuerySchema.parse(query);
    // Backend accepts `types` as CSV. Build params manually — toParams stringifies arrays poorly.
    let params = new HttpParams().set('q', parsed.q);
    if (parsed.types && parsed.types.length > 0) {
      params = params.set('types', parsed.types.join(','));
    }
    if (parsed.limit !== undefined) {
      params = params.set('limit', String(parsed.limit));
    }
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ADMIN_API_ROUTES.globalSearch.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => globalSearchResultSchema.parse(envelope(raw))));
  }
}
