/**
 * APP_ROUTES — single source of truth for the storefront URL surface.
 *
 * Per constitution §3.14 (route SSOT), every path the storefront renders or
 * navigates to is derived from this object. No hand-typed string paths in
 * components, services, or templates.
 *
 * Locale segment is the first path part (`/fr/...`, `/en/...`). The root
 * path `/` resolves a locale via cookie, then `Accept-Language`, then the `fr`
 * default, inside `src/server/middleware/locale-redirect.ts`.
 */

import type { Locale } from '../i18n/types';

/**
 * Query parameter that prefills the order number on the public track page.
 * Named here so the page reading it and the pages linking to it cannot drift
 * (§3.14).
 */
export const TRACK_ORDER_QUERY_PARAM = 'order';

export const APP_ROUTES = {
  root: '/',
  home: (locale: Locale) => `/${locale}/`,
  catalog: (locale: Locale, slug?: string) =>
    slug ? `/${locale}/catalog/${slug}` : `/${locale}/catalog`,
  product: (locale: Locale, slug: string) => `/${locale}/catalog/product/${slug}`,
  search: (locale: Locale) => `/${locale}/search`,
  cart: (locale: Locale) => `/${locale}/cart`,
  /**
   * Public order-track page (findings K9, K10).
   *
   * It used to live at `/account/orders/:id/track`, keyed by the order's
   * INTERNAL id, which the page then showed the customer as their "order
   * number". It is not an account page at all: the lookup is
   * `POST /v1/orders/track`, which is `@Public()` behind an email challenge, so
   * anyone holding the number on their confirmation can follow the order
   * without a session.
   *
   * The path is bare. An order number, when the caller has one, travels as the
   * {@link TRACK_ORDER_QUERY_PARAM} query parameter and only prefills the form
   * field: it is not the secret, the email is, and the number is already in the
   * confirmation URL. It is passed through Angular's `[queryParams]` rather
   * than baked in here, because `routerLink` percent-encodes a `?` inside a
   * path string and would produce `/en/track%3Forder%3D...`.
   */
  track: (locale: Locale) => `/${locale}/track`,
  checkout: (locale: Locale) => `/${locale}/checkout`,
  orderConfirmation: (locale: Locale, orderNumber: string) =>
    `/${locale}/order-confirmation/${encodeURIComponent(orderNumber)}`,
  auth: {
    login: (locale: Locale) => `/${locale}/auth/login`,
    register: (locale: Locale) => `/${locale}/auth/register`,
    forgotPassword: (locale: Locale) => `/${locale}/auth/forgot-password`,
    resetPassword: (locale: Locale) => `/${locale}/auth/reset-password`,
  },
  account: {
    index: (locale: Locale) => `/${locale}/account`,
    orders: (locale: Locale) => `/${locale}/account/orders`,
    order: (locale: Locale, id: string) => `/${locale}/account/orders/${id}`,
    addresses: (locale: Locale) => `/${locale}/account/addresses`,
    wishlist: (locale: Locale) => `/${locale}/account/wishlist`,
    profile: (locale: Locale) => `/${locale}/account/profile`,
    preferences: (locale: Locale) => `/${locale}/account/preferences`,
    returns: (locale: Locale) => `/${locale}/account/returns`,
  },
  about: (locale: Locale) => `/${locale}/about`,
  policy: (locale: Locale, slug: PolicySlug) => `/${locale}/policies/${slug}`,
  /**
   * Generic CMS page. Namespaced under `/pages/` rather than sitting at the
   * locale root: the `[locale]` directory already owns fourteen static
   * segments, and a top-level `[slug]` route would silently shadow any CMS
   * page whose slug collides with one of them, now or later.
   *
   * Accepts the slash-prefixed form the API stores (`/faq`) as well as the
   * bare one, so callers can pass a `CmsPage.slug` straight through.
   */
  page: (locale: Locale, slug: string) =>
    `/${locale}/pages/${encodeURIComponent(normalizeCmsSlug(slug))}`,
  error: (locale: Locale) => `/${locale}/error`,
} as const;

/** Strips the leading and trailing slashes the API stores CMS slugs with. */
function normalizeCmsSlug(slug: string): string {
  return slug.replace(/^\/+|\/+$/g, '');
}

/**
 * The CMS slugs that already have a dedicated storefront route, and therefore
 * never resolve through `APP_ROUTES.page`. Inverse of the storefront-to-CMS map
 * in `app/pages/[locale]/policies/[slug].server.ts` plus `/about`.
 *
 * Order matters to the spec that pins this list; keep it seed order.
 */
export const LEGACY_CMS_SLUGS = [
  'about',
  'privacy-policy',
  'return-policy',
  'terms',
  'shipping-info',
] as const;

const LEGACY_CMS_ROUTE: Record<(typeof LEGACY_CMS_SLUGS)[number], (locale: Locale) => string> = {
  about: (locale) => APP_ROUTES.about(locale),
  'privacy-policy': (locale) => APP_ROUTES.policy(locale, 'privacy'),
  'return-policy': (locale) => APP_ROUTES.policy(locale, 'returns'),
  terms: (locale) => APP_ROUTES.policy(locale, 'terms'),
  'shipping-info': (locale) => APP_ROUTES.policy(locale, 'shipping'),
};

export function isLegacyCmsSlug(slug: string): slug is (typeof LEGACY_CMS_SLUGS)[number] {
  return (LEGACY_CMS_SLUGS as readonly string[]).includes(normalizeCmsSlug(slug));
}

/**
 * The one place a CMS slug becomes a storefront URL. Legacy slugs keep their
 * canonical dedicated route so no duplicate-content twin appears under
 * `/pages/`; everything else resolves through the generic route.
 */
export function cmsPageRoute(locale: Locale, cmsSlug: string): string {
  const slug = normalizeCmsSlug(cmsSlug);
  const legacy = isLegacyCmsSlug(slug) ? LEGACY_CMS_ROUTE[slug] : undefined;
  return legacy ? legacy(locale) : APP_ROUTES.page(locale, slug);
}

export const POLICY_SLUGS = ['privacy', 'returns', 'terms', 'shipping'] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export function isPolicySlug(value: string | null | undefined): value is PolicySlug {
  return value === 'privacy' || value === 'returns' || value === 'terms' || value === 'shipping';
}

export const LOCALE_COOKIE = 'storefront_locale';
