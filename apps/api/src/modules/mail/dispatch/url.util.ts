/**
 * Storefront URL builders (NE4) shared by the dispatch resolvers, the mail
 * listeners and the scheduled processors.
 *
 * Every storefront page is served from `/{locale}/...`. The Analog route tree
 * under `apps/storefront/src/app/pages/[locale]/` has no un-prefixed entry, and
 * the Nitro middleware only redirects `/` and `/index.html`, so a path with no
 * locale segment falls through to the 404 page rather than being corrected.
 * These builders therefore take the recipient's locale, which every caller
 * already resolves in order to pick the template copy, and put it first. The
 * path shapes match `apps/storefront/src/lib/routes.ts`, which is the SSOT the
 * storefront itself links through.
 */
import type { ConfigService } from '@nestjs/config';
import type { MailLocale } from '../mail.types';
import { adminBaseUrl, storefrontBaseUrl } from '../config/public-hosts';

/** Storefront public origin plus the recipient's locale segment, no trailing slash. */
function localeBase(config: ConfigService, locale: MailLocale): string {
  return `${storefrontBaseUrl(config)}/${locale}`;
}

/**
 * Customer order-detail URL.
 *
 * Takes the order's `id`, not its `orderNumber`: the page reads the `[id]`
 * route param straight into `OrdersService.getById`, which reaches
 * `findOneStorefront` and looks the row up by primary key. A human order
 * number resolves to nothing and renders the not-found state.
 */
export function buildOrderUrl(config: ConfigService, locale: MailLocale, orderId: string): string {
  return `${localeBase(config, locale)}/account/orders/${encodeURIComponent(orderId)}`;
}

/**
 * Gift-card redemption URL.
 *
 * The storefront has no `/gift-cards/redeem` page. Redemption happens through
 * the gift-card form on the cart, so that is where the CTA goes. The code
 * rides in the query string; the cart does not read it yet, and the mail body
 * prints the code either way.
 */
export function buildRedemptionUrl(
  config: ConfigService,
  locale: MailLocale,
  code: string,
): string {
  return `${localeBase(config, locale)}/cart?code=${encodeURIComponent(code)}`;
}

/**
 * Customer returns URL.
 *
 * There is no per-return detail route, only the list at
 * `[locale]/account/returns`, which shows the return the mail is about. The
 * return number is not in the path because no route would match it.
 */
export function buildReturnUrl(config: ConfigService, locale: MailLocale): string {
  return `${localeBase(config, locale)}/account/returns`;
}

/** Product-detail URL, falling back to the catalogue index when the slug is unknown. */
export function buildProductUrl(
  config: ConfigService,
  locale: MailLocale,
  slug: string | null | undefined,
): string {
  const base = localeBase(config, locale);
  return slug ? `${base}/catalog/product/${encodeURIComponent(slug)}` : `${base}/catalog`;
}

/** Cart-recovery URL, re-opens the customer's cart for an abandoned-cart email. */
export function buildCartRecoveryUrl(
  config: ConfigService,
  locale: MailLocale,
  cartId: string,
): string {
  return `${localeBase(config, locale)}/cart?recover=${encodeURIComponent(cartId)}`;
}

/** Admin dashboard sign-in URL. A different host, and its paths carry no locale. */
export function buildAdminLoginUrl(config: ConfigService): string {
  return `${adminBaseUrl(config)}/login`;
}
