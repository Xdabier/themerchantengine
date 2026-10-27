import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Sets `X-Requested-With: XMLHttpRequest` on every request.
 *
 * The backend relies on this header (plus SameSite=Strict cookies and
 * `sec-fetch-site` checks) as its CSRF defense on the refresh endpoint.
 * There is no CSRF token — see `specs/admin-dashboard/clarifications.md`
 * Q3 for citations.
 *
 * Redundant but harmless on endpoints that don't require it; cheaper to
 * attach globally than to gate per-request.
 */
export const requestedWithInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.headers.has('X-Requested-With')) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { 'X-Requested-With': 'XMLHttpRequest' } }));
};
