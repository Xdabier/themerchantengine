import { APP_ROUTES } from './routes';
import { isLocale, type Locale } from '../i18n/types';

/**
 * Resolver for the `ctaHref` an operator configures on a HERO or
 * PROMOTIONAL_BANNER section. Before phase B4 the storefront ignored the field
 * entirely and both banner CTAs routed to the catalogue, so a merchant could
 * point a campaign anywhere and it went nowhere (finding S1b).
 *
 * Two rendering modes, because Angular's `routerLink` cannot carry an external
 * URL and a plain `href` would full-page-reload an internal one:
 *
 *  - `internal` feeds `[routerLink]`.
 *  - `external` feeds `[attr.href]` on a plain anchor with `rel="noopener"`.
 *
 * The API already allowlists the scheme at write time
 * (`apps/api/src/modules/storefront-config/dto/configs/cta-href.constants.ts`),
 * so the guard here is defense in depth over rows written before that landed,
 * or through any path that bypasses the DTO. Anything not site-relative and not
 * http(s) resolves to `null` and the caller falls back to the catalogue.
 *
 * Site-relative paths are locale-prefixed when they do not already carry a
 * locale segment: the seeds store `/catalog`, and every storefront route is
 * locale-prefixed, so rendering the stored value verbatim would 404.
 */
export type SectionCtaLink =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string };

export function resolveSectionCta(
  ctaHref: string | null | undefined,
  locale: Locale,
): SectionCtaLink | null {
  if (typeof ctaHref !== 'string') return null;
  const trimmed = ctaHref.trim();
  if (trimmed.length === 0) return null;

  if (/^https?:\/\//i.test(trimmed)) return { kind: 'external', href: trimmed };

  // Scheme-relative (`//evil.com`) and backslash variants are not site-relative
  // paths, whatever they look like. Rejecting them here mirrors the API regex.
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;

  return { kind: 'internal', href: localePrefixed(trimmed, locale) };
}

/** Resolved link, or the catalogue route when the configured href is unusable. */
export function resolveSectionCtaOrCatalog(
  ctaHref: string | null | undefined,
  locale: Locale,
): SectionCtaLink {
  return (
    resolveSectionCta(ctaHref, locale) ?? { kind: 'internal', href: APP_ROUTES.catalog(locale) }
  );
}

function localePrefixed(path: string, locale: Locale): string {
  const firstSegment = path.split('/')[1] ?? '';
  if (isLocale(firstSegment)) return path;
  return `/${locale}${path}`;
}
