import { DefaultUrlSerializer, UrlTree } from '@angular/router';

/**
 * URL serializer that preserves trailing slashes on locale-root paths, and
 * parses them back without inventing an empty trailing segment.
 *
 * `serialize()`: Angular's `DefaultUrlSerializer.serialize()` strips trailing
 * slashes unconditionally (it joins segments with '/' and never appends a
 * final '/'). The storefront URL contract uses trailing slashes on locale
 * roots: `APP_ROUTES.home(locale) === '/${locale}/'`. Without this serializer,
 * Angular Router normalises `/en/` to `/en` on first navigation which causes
 * `LocaleService.currentUrl()` to emit `/en` and the header's
 * `buildLocaleSwitchHref` to produce `/fr` instead of `/fr/`.
 *
 * `parse()`: `DefaultUrlSerializer.parse('/en/')` yields the segments
 * `['en', '']` — the trailing slash becomes a real EMPTY segment. No route
 * consumes an empty segment, so once `:locale` matches `en` only the
 * catch-all not-found route can match and the 404 page renders under the
 * unchanged `/en/` URL. A full page load never hits this because
 * `Location.normalize()` strips the trailing slash before the router parses
 * the initial URL, and `routerLink` never hits it because `createUrlTree`
 * filters empty command parts. Only a raw `navigateByUrl('/en/')` does, which
 * is what sign-out and the root-redirect fallback both do.
 *
 * Normalising the path here keeps the public URL contract (`/en/`) intact:
 * `serialize()` still re-appends the slash for locale roots.
 *
 * Grounded in: `agent_docs/storefront/architecture.md
 * ("URL becomes `/en/`"), `APP_ROUTES.home()` returning `/${locale}/`, and
 * finding A1 of `specs/features/storefront-qa-remediation/plan-h-auth-session-and-shell.md`.
 */
export class TrailingSlashUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    return super.parse(stripTrailingSlashFromPath(url));
  }

  override serialize(tree: UrlTree): string {
    const url = super.serialize(tree);
    // Re-append the trailing slash only when the serialized path is exactly a
    // locale root: '/fr' or '/en' (no further segments, no query, no fragment).
    // Paths like '/en/catalog' must NOT get a slash appended.
    if (/^\/(fr|en)$/.test(url)) {
      return `${url}/`;
    }
    return url;
  }
}

/**
 * Drop one trailing slash from the path portion only, leaving the query and
 * fragment untouched. The bare root `/` keeps its slash: there it is the path
 * itself, not a trailing separator.
 */
function stripTrailingSlashFromPath(url: string): string {
  const boundaries = [url.indexOf('?'), url.indexOf('#')].filter((i) => i >= 0);
  const cut = boundaries.length > 0 ? Math.min(...boundaries) : url.length;
  const path = url.slice(0, cut);
  if (path.length <= 1 || !path.endsWith('/')) return url;
  return `${path.slice(0, -1)}${url.slice(cut)}`;
}
