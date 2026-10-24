import { defineEventHandler, getCookie, getRequestHeader, sendRedirect } from 'h3';

import { resolveLocaleFromHeaders } from '../../lib/locale';
import { LOCALE_COOKIE } from '../../lib/routes';
import { isLocale, type Locale } from '../../i18n/types';
import { readStoreConfig } from '../store-config';

/**
 * A first path segment shaped like a BCP-47 language tag: `de`, `pt-BR`, or a
 * catalogue locale this store has not enabled. Deliberately narrow. Anything
 * else (`robots.txt`, `api`, `brand`) is not a locale segment and must fall
 * through untouched.
 */
const LANGUAGE_TAG_SEGMENT_RE = /^\/([a-z]{2}(?:-[A-Za-z]{2})?)(\/.*|)$/;

/**
 * Storefront Nitro middleware. Server-side `/` → `/{locale}/` 302 redirect.
 *
 * Closes the user-reported "lands on `/` and shows 404" defect (B1) — the
 * SSG output had no prerendered `/` entry, so the static surface returned
 * 404 until the client-side `pages/index.page.ts` redirect ran post-
 * hydration. Production traffic now hits this middleware first → 302 → no
 * SPA shell ever paints under `/`.
 *
 * Locale resolution order: user-set `storefront_locale` cookie, then the
 * `Accept-Language` header, then the store's configured default locale. The
 * locale set and the default both come from the runtime config (DR-31), read
 * through the process-cached `readStoreConfig`, because this handler runs
 * before Angular exists and there is no injector here to ask.
 * The cookie wins over `Accept-Language`
 * because it captures explicit user intent: `LocaleService` writes it whenever
 * the resolved locale changes, so the language toggle persists. Auto-detection
 * from `Accept-Language` is the fallback for the first-time visitor.
 *
 * The handler also owns the **unsupported-locale** case. Without it, a request
 * to `/de/catalog` matches the Analog `[locale]` route, `routeLocale()` fails to
 * recognise the segment, and the page renders the default locale under a 200,
 * which advertises an infinite set of duplicate URLs to a crawler. Any first
 * segment shaped like a language tag but not in the set the store serves is
 * 301'd onto its default locale instead. A catalogue locale the store has not
 * enabled is treated the same way: the build shipping a catalogue for it does
 * not mean this store sells in it.
 *
 * The Angular-side redirect at `apps/storefront/src/app/pages/index.page.ts`
 * is kept as a belt-and-suspenders for any pipeline that bypasses the Nitro
 * middleware entirely (some prerendered-static-host configurations).
 * `@analogjs/vite-plugin-nitro` auto-registers every middleware file under
 * `src/server/middleware/` with the Vite dev server's middleware chain at
 * startup (see `node_modules/@analogjs/vite-plugin-nitro/src/lib/utils/register-dev-middleware.js`
 * lines 43-66), so this same handler fires on Vite dev `GET /` and on
 * production Nitro `GET /` traffic. The earlier "Vite rewrites SPA routes
 * to `/index.html` before Nitro middleware fires" assumption was superseded
 * by that auto-registration upstream — recorded at
 * `specs/features/storefront-ssr-data-hydration/clarifications.md` §1.14.
 *
 * Non-`/` paths fall through to the static asset / SSG / SSR pipeline
 * untouched, except for the unsupported-locale 301 described above.
 * `/index.html` (the SSG bare entry that some hosts surface directly) is
 * treated as `/` for the purposes of the root redirect.
 */
export default defineEventHandler(async (event) => {
  // Prefer `req.originalUrl` over `event.path` (`req.url`) in the Analog Vite
  // dev server. Vite's internal middleware chain rewrites `req.url` to the
  // HTML entry (e.g. `/`) for SPA route matching, so `event.path` returns
  // `/` for every request including `/fr/` and `/en/catalog`. The
  // `originalUrl` is preserved by Node/connect and always equals the path the
  // browser actually requested.  In production Nitro, both values are
  // identical (no SPA fallback rewriting), so this change is safe for both
  // environments.
  const path = event.node.req.originalUrl ?? event.path ?? '';
  // Strip query string for path comparison (originalUrl may include ?q=...).
  const [pathname, ...queryParts] = path.split('?');
  const query = queryParts.length ? `?${queryParts.join('?')}` : '';

  const { localization } = await readStoreConfig();
  const supported = localization.supportedLocales as readonly Locale[];
  const defaultLocale = localization.defaultLocale as Locale;

  if (pathname !== '/' && pathname !== '/index.html') {
    const match = LANGUAGE_TAG_SEGMENT_RE.exec(pathname);
    // A locale the store serves, or not a locale segment at all: hand off.
    if (!match || (isLocale(match[1]) && supported.includes(match[1]))) return;
    const rest = match[2] || '/';
    await sendRedirect(event, `/${defaultLocale}${rest}${query}`, 301);
    return;
  }

  const cookieValue = getCookie(event, LOCALE_COOKIE) ?? null;
  const locale = resolveLocaleFromHeaders({
    cookie: cookieValue ? `${LOCALE_COOKIE}=${cookieValue}` : null,
    acceptLanguage: getRequestHeader(event, 'accept-language') ?? null,
    cookieName: LOCALE_COOKIE,
    supported,
    defaultLocale,
  });

  await sendRedirect(event, `/${locale}/`, 302);
});
