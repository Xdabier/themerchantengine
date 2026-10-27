import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import {
  type SettingsLocales,
  settingsLocalesSchema,
  type SettingsResponse,
  settingsResponseSchema,
  type UpdateLocalesRequest,
  updateLocalesRequestSchema,
  type UpdateSettingsRequest,
  updateSettingsRequestSchema,
} from './settings.schemas';

const SETTINGS = ADMIN_API_ROUTES.settings;

/** `/v1/admin/settings/*` — store config. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /** GET /v1/admin/settings */
  getAll(): Observable<SettingsResponse> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SETTINGS.base)}`, { withCredentials: true })
      .pipe(map((raw) => settingsResponseSchema.parse(envelope(raw))));
  }

  /**
   * PATCH /v1/admin/settings
   *
   * Throws when the request schema strips every key it was given.
   *
   * That is not a hypothetical: `/settings/integrations` wrote six keys the
   * schema does not model, so this method sent `{}`, the API answered 200 with
   * nothing changed, and the screen reported "Integrations saved." for values
   * that were never stored anywhere. A save whose whole body was dropped is
   * never a success, and the error names the dropped keys so the next unwired
   * field is identified in the message rather than by bisecting a form.
   */
  update(input: UpdateSettingsRequest): Observable<SettingsResponse> {
    // Every failure leaves through the stream, never as a synchronous throw.
    //
    // A screen calls this from a submit handler that has already flipped its
    // `busy` flag, and its only failure path is the `error` callback of the
    // subscribe below. A throw from here escapes that callback entirely: the
    // button spins forever, Revert stays disabled behind `busy`, and the
    // operator has to reload the page. That is what a parse failure did once
    // the schema gained bounds a form can violate, an empty Translatable
    // `default` among them, and it is the same shape that hung the bulk-price
    // dialog when the number input reported a string.
    let body: UpdateSettingsRequest;
    try {
      body = updateSettingsRequestSchema.parse(input);
    } catch (err) {
      return throwError(() => err);
    }
    if (Object.keys(body).length === 0) {
      const dropped = Object.keys(input as Record<string, unknown>);
      return throwError(
        () =>
          new Error(
            `SettingsService.update: no recognised settings in the request body. ` +
              `Dropped by updateSettingsRequestSchema: ${dropped.length ? dropped.join(', ') : '(nothing sent)'}.`,
          ),
      );
    }
    return this.http
      .patch<unknown>(`${this.apiBase}/${adminRoute(SETTINGS.base)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => settingsResponseSchema.parse(envelope(raw))));
  }

  /** GET /v1/admin/settings/locales */
  getLocales(): Observable<SettingsLocales> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SETTINGS.base, SETTINGS.locales)}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => settingsLocalesSchema.parse(envelope(raw))));
  }

  /** PATCH /v1/admin/settings/locales — enforces defaultLocale ∈ supportedLocales. */
  updateLocales(input: UpdateLocalesRequest): Observable<SettingsLocales> {
    // Through the stream, for the same reason `update` is: the locales screen
    // calls this under a `busy` flag whose only reset is the error callback.
    // Its own guards mirror this schema today, so nothing reaches it, which is
    // exactly how the sibling above stayed unnoticed until a bound changed.
    let body: UpdateLocalesRequest;
    try {
      body = updateLocalesRequestSchema.parse(input);
    } catch (err) {
      return throwError(() => err);
    }
    return this.http
      .patch<unknown>(`${this.apiBase}/${adminRoute(SETTINGS.base, SETTINGS.locales)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => settingsLocalesSchema.parse(envelope(raw))));
  }
}
