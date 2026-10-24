import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay, tap } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import {
  type CountriesResponse,
  countriesResponseSchema,
  type UpdateCountriesRequest,
  updateCountriesRequestSchema,
} from './countries.schemas';

@Injectable({ providedIn: 'root' })
export class CountriesService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  private cached?: Observable<CountriesResponse>;

  /**
   * Cached catalogue read for pickers. The ISO list is static and every
   * country select on a screen asks for it, so one request serves them all
   * until an `update()` changes the enabled set.
   */
  listCached(): Observable<CountriesResponse> {
    this.cached ??= this.list().pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.cached;
  }

  list(): Observable<CountriesResponse> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ADMIN_API_ROUTES.countries.base)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => countriesResponseSchema.parse(envelope(raw))));
  }

  update(input: UpdateCountriesRequest): Observable<CountriesResponse> {
    const body = updateCountriesRequestSchema.parse(input);
    return this.http
      .patch<unknown>(`${this.apiBase}/${adminRoute(ADMIN_API_ROUTES.countries.base)}`, body, {
        withCredentials: true,
      })
      .pipe(
        map((raw) => countriesResponseSchema.parse(envelope(raw))),
        tap(() => (this.cached = undefined)),
      );
  }
}
