import { DEFAULT_LOCALE, LOCALE_CATALOGUE, isLocale, type Locale } from '../i18n/types';

/**
 * Locale resolution helpers shared by the server middleware (root redirect)
 * and client-side route navigation.
 */

/**
 * Matches any locale the build ships a catalogue for, not the pair one store
 * serves. Built from the catalogue rather than written out, so adding a
 * language is one edit in `i18n/types.ts`.
 *
 * Deliberately the catalogue and not the store's configured set: a path
 * prefixed with a catalogue locale the store has not enabled is a real URL
 * shape a crawler can hold, and it has to resolve the same way an unknown
 * prefix does rather than being read as part of a slug.
 */
const LOCALE_PREFIX_RE = new RegExp(`^/(${LOCALE_CATALOGUE.join('|')})(/|$)`);

export function localeFromPathname(pathname: string): Locale | null {
  const match = LOCALE_PREFIX_RE.exec(pathname);
  return match && isLocale(match[1]) ? (match[1] as Locale) : null;
}

/**
 * Authoritative request locale for a page-server companion: the matched
 * `[locale]` route segment, which Analog passes to every loader as
 * `params.locale` (=== `event.context.params.locale`). Returns null when the
 * segment is absent or unrecognised so the caller can fall back.
 *
 * This is the SSOT for the SSR data-fetch locale. NEVER parse it from `req.url`
 * inside a Nitro page endpoint: there the url is the internal
 * `/api/_analog/pages/<locale>/...` path, which `localeFromPathname` cannot read.
 */
export function routeLocale(params: Record<string, unknown> | null | undefined): Locale | null {
  const raw = params?.['locale'];
  return typeof raw === 'string' && isLocale(raw) ? raw : null;
}

/**
 * Replace the leading locale segment of `currentUrl` with `nextLocale`,
 * preserving the rest of the path, the query string, and the fragment.
 *
 * URLs without a recognised locale prefix are returned unchanged so layout
 * shell links never silently rewrite arbitrary pages (e.g. `/healthz`).
 */
export function buildLocaleSwitchHref(currentUrl: string, nextLocale: Locale): string {
  return currentUrl.replace(LOCALE_PREFIX_RE, `/${nextLocale}$2`);
}

/**
 * Resolve a locale from a raw `Accept-Language` header.
 * Returns the first supported locale tag, or null if none match.
 *
 * RFC 7231 §5.3.5 quality values are honoured.
 *
 * `supported` narrows which catalogue locale counts as a match. Without it,
 * every catalogue locale (including one this store has not enabled) is
 * eligible, which is the client-side last-resort caller's contract (no
 * config to read at that layer). With it, a header naming a catalogue locale
 * the store does not serve is skipped in favour of the next candidate by
 * q-value, not treated as a match that then gets thrown away: `ar,fr;q=0.9`
 * on a store that serves only `fr`+`en` must resolve to `fr`, not fall
 * through to the default the moment `ar` — the single highest-q candidate —
 * turns out to be unsupported.
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
  supported?: readonly Locale[],
): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((c) => Number.isFinite(c.q) && c.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const c of candidates) {
    if (!isLocale(c.tag)) continue;
    if (supported && !supported.includes(c.tag)) continue;
    return c.tag as Locale;
  }
  return null;
}

export function localeFromCookieHeader(
  cookieHeader: string | null | undefined,
  name: string,
): Locale | null {
  if (!cookieHeader) return null;
  for (const piece of cookieHeader.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === name) {
      const value = decodeURIComponent(rest.join('='));
      if (isLocale(value)) return value as Locale;
    }
  }
  return null;
}

/**
 * Resolve a locale from request headers.
 *
 * Order: explicit cookie, then `Accept-Language`, then the store's default.
 * A cookie or header naming a locale the store does not serve is skipped
 * rather than honoured: it was set by another install or another visit, and
 * serving a language the store has no catalogue enabled for is worse than
 * falling through. The
 * cookie wins because it carries a deliberate choice the visitor made with the
 * language switcher, while `Accept-Language` is browser configuration the visitor
 * may never have looked at. This matches the Nitro root-redirect middleware at
 * `src/server/middleware/locale-redirect.ts`, which resolves in the same order.
 */
export function resolveLocaleFromHeaders(headers: {
  acceptLanguage?: string | null;
  cookie?: string | null;
  cookieName: string;
  /** The locales the store serves, and the one it falls back to. */
  supported?: readonly Locale[];
  defaultLocale?: Locale;
}): Locale {
  const fallback = headers.defaultLocale ?? DEFAULT_LOCALE;
  const serves = (locale: Locale | null): Locale | null => {
    if (!locale) return null;
    if (!headers.supported) return locale;
    return headers.supported.includes(locale) ? locale : null;
  };
  return (
    serves(localeFromCookieHeader(headers.cookie, headers.cookieName)) ??
    localeFromAcceptLanguage(headers.acceptLanguage, headers.supported) ??
    fallback
  );
}
