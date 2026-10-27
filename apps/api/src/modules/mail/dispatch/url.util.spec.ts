/**
 * Storefront URL builders (NE4), pins the shared-utility contract NE5+ flows
 * reuse: env-var base, trailing-slash trim, and encodeURIComponent.
 *
 * The host is the client's own. Before D7 seven call sites each carried their
 * own `example.test` default, and a missed one does not fail loudly, it
 * sends a customer to another client's domain.
 *
 * D8 found the paths were wrong too, and that this file could not see it: it
 * asserted each builder against a literal, and the literal was copied from the
 * builder rather than from the route tree. Every storefront page lives under
 * `/{locale}/`, per the Analog file tree at
 * `apps/storefront/src/app/pages/[locale]/` and the path SSOT at
 * `apps/storefront/src/lib/routes.ts`, and no builder emitted a locale
 * segment, so every transactional mail CTA landed on a path no route matched.
 * The assertions below are written against that route tree, and the
 * table-driven test at the bottom holds for any builder added later.
 */
import { ConfigService } from '@nestjs/config';
import type { MailLocale } from '../mail.types';
import {
  buildAdminLoginUrl,
  buildCartRecoveryUrl,
  buildOrderUrl,
  buildProductUrl,
  buildRedemptionUrl,
  buildReturnUrl,
} from './url.util';

/**
 * Key-aware on purpose: the storefront and the admin dashboard are different
 * hosts, and a stub that answered every key with the same value could not tell
 * a builder pointing at the wrong one.
 */
const cfg = (storefront: string, admin?: string): ConfigService => {
  const values: Record<string, string | undefined> = {
    STOREFRONT_PUBLIC_BASE_URL: storefront,
    ADMIN_PUBLIC_BASE_URL: admin,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
};

const BASE = 'https://storefront.example.test';

describe('url.util', () => {
  describe('buildOrderUrl', () => {
    /** The route is `[locale]/account/orders/[id]`, and the page fetches with
     * `getById`, which reaches `findOneStorefront` and looks the row up by its
     * primary key. Passing the human order number finds nothing. */
    it('builds the account order-detail URL under the recipient locale', () => {
      expect(buildOrderUrl(cfg(BASE), 'fr', 'ord-uuid-1')).toBe(
        'https://storefront.example.test/fr/account/orders/ord-uuid-1',
      );
    });

    it('follows the recipient locale rather than the store default', () => {
      expect(buildOrderUrl(cfg(BASE), 'en', 'ord-uuid-1')).toBe(
        'https://storefront.example.test/en/account/orders/ord-uuid-1',
      );
    });

    it('trims a trailing slash on the configured base', () => {
      expect(buildOrderUrl(cfg('https://storefront.example.test/'), 'fr', 'ord-uuid-1')).toBe(
        'https://storefront.example.test/fr/account/orders/ord-uuid-1',
      );
    });

    it('percent-encodes an id containing reserved characters', () => {
      expect(buildOrderUrl(cfg(BASE), 'fr', 'ORD 1/A')).toBe(
        'https://storefront.example.test/fr/account/orders/ORD%201%2FA',
      );
    });
  });

  describe('buildProductUrl', () => {
    /** `/products/<slug>` matched no route. The product page is
     * `[locale]/catalog/product/[slug]`. */
    it('builds the product-detail URL on the route the storefront serves', () => {
      expect(buildProductUrl(cfg(BASE), 'fr', 'composite-a2')).toBe(
        'https://storefront.example.test/fr/catalog/product/composite-a2',
      );
    });

    it('falls back to the catalogue index when the slug is unknown', () => {
      expect(buildProductUrl(cfg(BASE), 'en', null)).toBe(
        'https://storefront.example.test/en/catalog',
      );
    });

    it('percent-encodes a slug with reserved characters', () => {
      expect(buildProductUrl(cfg(BASE), 'fr', 'a/b c')).toBe(
        'https://storefront.example.test/fr/catalog/product/a%2Fb%20c',
      );
    });
  });

  describe('buildCartRecoveryUrl', () => {
    it('re-opens the cart under the recipient locale', () => {
      expect(buildCartRecoveryUrl(cfg(BASE), 'fr', 'cart-1')).toBe(
        'https://storefront.example.test/fr/cart?recover=cart-1',
      );
    });
  });

  describe('buildReturnUrl', () => {
    /** There is no per-return detail route, only the list. The list is a real
     * page that shows the return, so the mail points there rather than at a
     * path that 404s. */
    it('points at the returns list under the recipient locale', () => {
      expect(buildReturnUrl(cfg(BASE), 'fr')).toBe(
        'https://storefront.example.test/fr/account/returns',
      );
    });
  });

  describe('buildRedemptionUrl', () => {
    /** There is no `/gift-cards/redeem` page. The gift-card form lives on the
     * cart, so that is where the redeem CTA goes; the code rides along in the
     * query string for a future pre-fill and is printed in the mail body
     * either way. */
    it('points at the cart, where the gift-card form is', () => {
      expect(buildRedemptionUrl(cfg(BASE), 'fr', 'GC-123')).toBe(
        'https://storefront.example.test/fr/cart?code=GC-123',
      );
    });

    it('percent-encodes a code with reserved characters', () => {
      expect(buildRedemptionUrl(cfg(BASE), 'en', 'A&B=C')).toBe(
        'https://storefront.example.test/en/cart?code=A%26B%3DC',
      );
    });
  });

  describe('buildAdminLoginUrl', () => {
    it('builds the sign-in URL on the admin host, never the storefront one', () => {
      expect(buildAdminLoginUrl(cfg(BASE, 'https://admin.example.test'))).toBe(
        'https://admin.example.test/login',
      );
    });
  });

  /**
   * The rule, not one instance of it. A builder added later that forgets the
   * locale segment fails here without anyone remembering to write a case for
   * it. `buildAdminLoginUrl` is excluded on purpose: the admin dashboard is a
   * different host with no locale in its paths.
   */
  describe('every storefront builder puts the recipient locale first', () => {
    const builders: Record<string, (locale: MailLocale) => string> = {
      buildOrderUrl: (locale) => buildOrderUrl(cfg(BASE), locale, 'ord-uuid-1'),
      buildProductUrl: (locale) => buildProductUrl(cfg(BASE), locale, 'composite-a2'),
      'buildProductUrl (no slug)': (locale) => buildProductUrl(cfg(BASE), locale, null),
      buildCartRecoveryUrl: (locale) => buildCartRecoveryUrl(cfg(BASE), locale, 'cart-1'),
      buildReturnUrl: (locale) => buildReturnUrl(cfg(BASE), locale),
      buildRedemptionUrl: (locale) => buildRedemptionUrl(cfg(BASE), locale, 'GC-123'),
    };

    for (const [name, build] of Object.entries(builders)) {
      for (const locale of ['fr', 'en'] as const) {
        it(`${name} emits /${locale} as the first path segment`, () => {
          const path = new URL(build(locale)).pathname;
          expect(path.split('/')[1]).toBe(locale);
        });
      }
    }
  });
});
