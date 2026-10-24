import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Translatable } from '../interfaces';
import { type LocaleSource, storeLocales } from '../locale/store-locales';

/**
 * Global interceptor that resolves Translatable JSONB objects to strings.
 *
 * - X-Locale: fr          resolves each Translatable field to its `fr` value
 * - Accept-Language: fr   same, when X-Locale is absent
 * - X-Resolve-Locale: false returns the full Translatable object (admin mode)
 *
 * `X-Locale` takes precedence, and it exists because a browser will not let a
 * page set `Accept-Language`. It is a forbidden header name in the Fetch
 * standard: Chromium relaxed that years ago, WebKit did not. So on Safari the
 * storefront's client-side calls carried the phone's language no matter what
 * the shop was set to, and a French customer with an English iPhone read
 * English product text. Proved rather than inferred: in one captured request
 * the app's own `x-request-id` and `accept` arrived intact while
 * `accept-language` was the browser default.
 *
 * Server-side rendering is unaffected either way, because a server can set any
 * header it likes, and it keeps sending `Accept-Language`. Anything that does
 * not send `X-Locale` behaves exactly as before.
 *
 * Fallback chain, three rungs in this order (DR-31, `agent_docs/i18n.md`): the
 * requested locale key, then the store's default locale, then the
 * always-present `default` key. The store's locale set is runtime config; it
 * arrives through a `LocaleSource`, by default the process-wide snapshot the
 * API's `StoreLocaleRegistry` keeps current.
 *
 * A request naming a locale outside the supported set still runs all three
 * rungs: it parses to a sentinel that is deliberately not a key any Translatable
 * can carry, so the first rung misses and the request resolves to the store
 * default, then to `default`. A stray key left in an old JSONB row from a locale
 * the store no longer enables can therefore never be selected.
 *
 * A request with NO Accept-Language header is the separate case: it parses to
 * `default` and the first rung satisfies it, because a caller that states no
 * preference should get the store's default value.
 */
@Injectable()
export class TranslatableInterceptor implements NestInterceptor {
  constructor(private readonly locales: LocaleSource = storeLocales) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    // Admin header: return full Translatable objects untouched
    if (request.headers['x-resolve-locale'] === 'false') {
      return next.handle();
    }

    const { supportedLocales, defaultLocale } = this.locales.current();
    const locale = resolveRequestLocale(request, supportedLocales);

    return next.handle().pipe(map((data) => resolveTranslatables(data, locale, defaultLocale)));
  }
}

/**
 * Sentinel for a tag outside the supported set.
 *
 * It must never collide with a real Translatable key, which is why it is not
 * `'default'`: `default` is required on every Translatable, so returning it
 * here would satisfy the resolver's FIRST rung and make the store-default rung
 * unreachable for every unsupported locale. The leading NUL cannot appear in a
 * JSONB key written by this application.
 */
const UNSUPPORTED_LOCALE = '\u0000unsupported';

/**
 * The locale a request is asking for, from the header it was able to set.
 *
 * `X-Locale` wins when it names a supported locale. An `X-Locale` that names
 * something unsupported is NOT allowed to fall through to `Accept-Language`:
 * a caller that stated a preference explicitly gets that preference resolved
 * by the same rules as any other, rather than silently getting a different
 * answer than it asked for.
 */
export function resolveRequestLocale(
  request: {
    headers: Record<string, string | string[] | undefined>;
  },
  supportedLocales: readonly string[] = storeLocales.current().supportedLocales,
): string {
  const explicit = request.headers['x-locale'];
  const value = Array.isArray(explicit) ? explicit[0] : explicit;
  if (value && value.trim()) return parseLocale(value, supportedLocales);
  const acceptLanguage = request.headers['accept-language'];
  return parseLocale(
    Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage,
    supportedLocales,
  );
}

/**
 * Parses the first locale from an Accept-Language header value.
 * "fr-CA;q=0.9,en;q=0.8" gives "fr"
 *
 * Returns 'default' when the header is absent (no preference stated), and
 * {@link UNSUPPORTED_LOCALE} when it names a locale outside the supported set,
 * so that case falls through the resolver's store-default then 'default' rungs.
 */
export function parseLocale(
  acceptLanguage: string | undefined,
  supportedLocales: readonly string[] = storeLocales.current().supportedLocales,
): string {
  if (!acceptLanguage) return 'default';
  const firstTag = acceptLanguage.split(',')[0].trim();
  const lang = firstTag.split(';')[0].trim().split('-')[0].toLowerCase();
  if (!lang) return 'default';
  return supportedLocales.includes(lang) ? lang : UNSUPPORTED_LOCALE;
}

/**
 * Returns true if the value looks like a Translatable object:
 * - is a plain object (not array)
 * - has a `default` key whose value is a string
 * - every value in the object is a string
 */
export function isTranslatable(value: unknown): value is Translatable {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    'default' in obj &&
    typeof obj['default'] === 'string' &&
    Object.values(obj).every((v) => typeof v === 'string')
  );
}

/**
 * Returns true when `data` is a plain object (object/null prototype) whose
 * keys we're safe to enumerate + rebuild. Non-plain class instances like
 * `Prisma.Decimal`, `Date`, `Buffer`, `Map`, `Set` must pass through
 * untouched so their `toJSON()` / prototype-driven serialisation survives,
 * otherwise Decimal collapses to `{s,e,d}` and Date becomes `{}` in the
 * response, both of which Zod rejects and the Angular client would throw on.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Resolves ONE Translatable to a string for the requested locale.
 *
 * The three-rung chain from spec §02 and DR-31: requested locale, then the
 * store default locale, then `default`. The middle rung is the one that gets
 * dropped when this is hand-rolled at a call site, and dropping it is not
 * cosmetic: `default` is explicitly allowed to differ from every locale value,
 * so a two-rung copy returns a different string from the interceptor for the
 * same row and the same locale.
 *
 * Exported as the single source (§3.14) so a caller that needs to resolve a
 * value outside the response pipeline does not have to re-implement the rule.
 * `resolveTranslatables` below is the recursive walker and delegates here.
 */
export function resolveTranslatable(
  value: unknown,
  locale: string,
  defaultLocale: string = storeLocales.current().defaultLocale,
): string {
  if (typeof value === 'string') return value;
  if (!isTranslatable(value)) return '';
  const obj = value as Record<string, string>;
  return obj[locale] ?? obj[defaultLocale] ?? obj['default'] ?? '';
}

/**
 * Recursively walks the response payload and resolves any Translatable
 * objects to their string value for the requested locale. Non-plain class
 * instances are left untouched (see isPlainObject).
 */
export function resolveTranslatables(
  data: unknown,
  locale: string,
  defaultLocale: string = storeLocales.current().defaultLocale,
): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item) => resolveTranslatables(item, locale, defaultLocale));
  }

  if (isTranslatable(data)) {
    return resolveTranslatable(data, locale, defaultLocale);
  }

  if (isPlainObject(data)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = resolveTranslatables(value, locale, defaultLocale);
    }
    return result;
  }

  return data;
}
