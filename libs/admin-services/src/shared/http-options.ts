import { HttpContext, HttpContextToken, HttpHeaders } from '@angular/common/http';

/**
 * Shared HttpContext tokens used across every admin service.
 * Services MUST NOT duplicate these — always import from this module so the
 * interceptor chain behaves consistently.
 */

/**
 * When true, the accept-language interceptor sends `X-Resolve-Locale: false`
 * so the backend returns the raw Translatable object (needed for every admin
 * form that binds JSONB `{default, fr, en}` shapes). Defaults to **true**
 * because every admin surface wants the raw object; opt out per-call via
 * `resolvedLocaleContext()` if you explicitly need the backend to collapse
 * the Translatable down to the Accept-Language locale.
 */
export const ADMIN_RAW_LOCALE = new HttpContextToken<boolean>(() => true);

export function rawLocaleContext(): HttpContext {
  return new HttpContext().set(ADMIN_RAW_LOCALE, true);
}

/** Build HttpHeaders that flag a request as "raw Translatable" (admin forms). */
export function rawLocaleHeaders(base: Record<string, string> = {}): HttpHeaders {
  return new HttpHeaders({ ...base, 'X-Resolve-Locale': 'false' });
}

/**
 * Extract payload from the `{data, meta?}` envelope. Pair with Zod parsing at
 * call sites. Keeping this untyped-ish on purpose — service methods own the
 * Zod validation.
 */
export function envelope<T = unknown>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

/** Utility for building `HttpParams`-compatible objects from loose values. */
export function toParams(
  input: Record<string, string | number | boolean | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = String(v);
  }
  return out;
}
