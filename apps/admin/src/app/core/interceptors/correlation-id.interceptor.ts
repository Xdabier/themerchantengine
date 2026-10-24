import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Injects `X-Request-Id` header with a fresh UUID per request so backend logs
 * can be traced across services. Value is echoed back in the error normalizer
 * so we can surface it in toasts / 500 pages for support lookup.
 */
export const correlationIdInterceptor: HttpInterceptorFn = (req, next) => {
  // Skip if caller already set one (e.g. retries carrying the original ID).
  if (req.headers.has('X-Request-Id')) {
    return next(req);
  }
  const correlationId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return next(req.clone({ setHeaders: { 'X-Request-Id': correlationId } }));
};
