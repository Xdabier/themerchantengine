import {
  HttpErrorResponse,
  HttpHeaders,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { catchError, of, throwError } from 'rxjs';
import { mapHttpErrorToApiError } from '@admin-types';

/**
 * Terminal interceptor: catches every `HttpErrorResponse` and maps it to the
 * typed `ApiError` hierarchy so the rest of the app works exclusively with
 * typed exceptions, never raw HTTP responses.
 *
 * Must run LAST in the chain — after refreshInterceptor gets its chance to
 * retry 401s, and after error paths elsewhere bubble up.
 *
 * Special-case for HTTP 304 Not Modified (constitution §3.X-B): Angular's
 * `HttpClient` routes any non-2xx response to the error stream, so a 304
 * lands here as an `HttpErrorResponse` with `status === 304`. 304 is success
 * in HTTP semantics — the server is telling us our cached value is still
 * valid. Mapping it to an `ApiError` makes TanStack Query treat the request
 * as failed and surfaces a generic "Could not load X. Please retry." toast,
 * which is the misbehavior the 2026-05-16 incident traced. Instead, emit a
 * synthetic `HttpResponse<null>` so the TanStack Query observer keeps its
 * existing cached value. The API defaults `Cache-Control: no-store`
 * (constitution §3.X-A) so 304 should never reach here in practice; this
 * branch is the defence-in-depth that closes the cascade if the cache
 * header ever regresses.
 */
export const errorNormalizerInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse)) {
        return throwError(() => err);
      }

      if (err.status === 304) {
        return of(
          new HttpResponse<null>({
            body: null,
            headers: err.headers ?? new HttpHeaders(),
            status: 304,
            statusText: err.statusText,
            url: err.url ?? undefined,
          }),
        );
      }

      const correlationId =
        req.headers.get('X-Request-Id') ?? err.headers?.get?.('X-Request-Id') ?? null;
      const retryAfterHeader = err.headers?.get?.('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

      return throwError(() =>
        mapHttpErrorToApiError({
          status: err.status,
          body: err.error,
          correlationId,
          retryAfterSeconds: Number.isNaN(retryAfterSeconds as number) ? null : retryAfterSeconds,
        }),
      );
    }),
  );
};
