import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Sets `withCredentials: true` on every API request so the browser attaches
 * the Better Auth `HttpOnly` session cookie.
 *
 * After the Better Auth migration (DR-24) authorization rides a cookie, not a
 * bearer header. A cookie is only sent on a cross-origin request when the
 * request opts in — and in production the admin (`admin.<domain>`) and the API
 * (`api.<domain>`) are different origins. Same-origin dev traffic is
 * unaffected. Auth calls themselves bypass this chain entirely: they go
 * through the Better Auth client, whose own fetch stack sets
 * `credentials: 'include'`.
 *
 * Replaces the retired bearer-token `authInterceptor`.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
