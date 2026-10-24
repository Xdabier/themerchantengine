import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import {
  type CurrenciesResponse,
  currenciesResponseSchema,
  type StoreCurrency,
  storeCurrencySchema,
  type UpdateCurrenciesRequest,
  updateCurrenciesRequestSchema,
} from './currencies.schemas';

@Injectable({ providedIn: 'root' })
export class CurrenciesService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(): Observable<CurrenciesResponse> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ADMIN_API_ROUTES.currencies.base)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => currenciesResponseSchema.parse(envelope(raw))));
  }

  /**
   * The store display currency + enabled set. Readable by any authenticated
   * operator (DR-26), unlike `list()` which needs `settings:view`.
   */
  getStore(): Observable<StoreCurrency> {
    const route = adminRoute(ADMIN_API_ROUTES.currencies.base, ADMIN_API_ROUTES.currencies.store);
    return this.http
      .get<unknown>(`${this.apiBase}/${route}`, { withCredentials: true })
      .pipe(map((raw) => storeCurrencySchema.parse(envelope(raw))));
  }

  update(input: UpdateCurrenciesRequest): Observable<CurrenciesResponse> {
    const body = updateCurrenciesRequestSchema.parse(input);
    return this.http
      .patch<unknown>(`${this.apiBase}/${adminRoute(ADMIN_API_ROUTES.currencies.base)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => currenciesResponseSchema.parse(envelope(raw))));
  }
}
