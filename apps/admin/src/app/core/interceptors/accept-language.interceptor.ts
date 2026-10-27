import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ADMIN_RAW_LOCALE } from '@admin-services';
import { AuthStore } from '../stores/auth.store';

/**
 * Sets `Accept-Language` from the current auth locale. Admin edit flows that
 * need the raw Translatable object from the backend opt in via
 * `rawLocaleContext()` — this interceptor picks up that context flag and
 * attaches `X-Resolve-Locale: false` so the backend's TranslatableInterceptor
 * returns the untouched JSONB object instead of collapsing it down to the
 * `Accept-Language` locale.
 */
export const acceptLanguageInterceptor: HttpInterceptorFn = (req, next) => {
  const setHeaders: Record<string, string> = {};
  if (!req.headers.has('Accept-Language')) {
    setHeaders['Accept-Language'] = inject(AuthStore).locale();
  }
  if (req.context.get(ADMIN_RAW_LOCALE) && !req.headers.has('X-Resolve-Locale')) {
    setHeaders['X-Resolve-Locale'] = 'false';
  }
  if (Object.keys(setHeaders).length === 0) {
    return next(req);
  }
  return next(req.clone({ setHeaders }));
};
