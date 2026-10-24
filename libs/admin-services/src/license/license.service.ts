import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope } from '../shared';
import { type LicenseVerdict, licenseVerdictSchema } from './license.schemas';

const LICENSE = ADMIN_API_ROUTES.license;

/** `/v1/admin/license` — the offline license verdict (plan E1.5, DR-31). */
@Injectable({ providedIn: 'root' })
export class LicenseService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  /**
   * GET /v1/admin/license
   *
   * The engine verifies the license once at boot and answers from that
   * verdict. `fresh` makes it re-read and re-verify the file, which is what
   * the settings page does after an upload: without it the page would show the
   * verdict of the file the operator just replaced.
   */
  current(fresh = false): Observable<LicenseVerdict> {
    const params = fresh ? new HttpParams().set('fresh', '1') : undefined;
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(LICENSE.base)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => licenseVerdictSchema.parse(envelope(raw))));
  }

  /**
   * POST /v1/admin/license/install
   *
   * Sends the operator's file for the engine to verify. The engine refuses
   * anything that does not verify and writes nothing, so a rejected upload
   * leaves the install exactly as it was; the response is the verdict of the
   * file that is now on disk.
   *
   * Multipart rather than JSON on purpose: this is a file the operator was
   * given, and reading it in the browser to re-encode it would be a step that
   * can only lose bytes.
   */
  install(file: File): Observable<LicenseVerdict> {
    const body = new FormData();
    body.append('file', file);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(LICENSE.base, LICENSE.install)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => licenseVerdictSchema.parse(envelope(raw))));
  }
}
