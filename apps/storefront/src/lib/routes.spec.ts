import { describe, expect, it } from 'vitest';
import {
  APP_ROUTES,
  LEGACY_CMS_SLUGS,
  POLICY_SLUGS,
  TRACK_ORDER_QUERY_PARAM,
  cmsPageRoute,
  isLegacyCmsSlug,
  isPolicySlug,
} from './routes';

describe('APP_ROUTES', () => {
  describe('orderConfirmation', () => {
    it('builds the localized order-confirmation path for ar', () => {
      expect(APP_ROUTES.orderConfirmation('fr', 'AKL-0001')).toBe(
        '/fr/order-confirmation/AKL-0001',
      );
    });

    it('builds the localized order-confirmation path for en', () => {
      expect(APP_ROUTES.orderConfirmation('en', 'AKL-0001')).toBe(
        '/en/order-confirmation/AKL-0001',
      );
    });

    it('encodes URL-reserved characters in the orderNumber segment', () => {
      expect(APP_ROUTES.orderConfirmation('en', 'ORD-2026/0001')).toBe(
        '/en/order-confirmation/ORD-2026%2F0001',
      );
    });
  });

  describe('checkout', () => {
    it('builds the localized checkout path for both locales', () => {
      expect(APP_ROUTES.checkout('fr')).toBe('/fr/checkout');
      expect(APP_ROUTES.checkout('en')).toBe('/en/checkout');
    });
  });

  describe('about', () => {
    it('builds /about for both locales', () => {
      expect(APP_ROUTES.about('fr')).toBe('/fr/about');
      expect(APP_ROUTES.about('en')).toBe('/en/about');
    });
  });

  describe('policy', () => {
    it('builds policy paths for each allowlisted slug', () => {
      expect(APP_ROUTES.policy('fr', 'privacy')).toBe('/fr/policies/privacy');
      expect(APP_ROUTES.policy('en', 'returns')).toBe('/en/policies/returns');
      expect(APP_ROUTES.policy('en', 'terms')).toBe('/en/policies/terms');
      expect(APP_ROUTES.policy('fr', 'shipping')).toBe('/fr/policies/shipping');
    });
  });

  describe('page', () => {
    it('builds the generic CMS path for both locales', () => {
      expect(APP_ROUTES.page('fr', 'faq')).toBe('/fr/pages/faq');
      expect(APP_ROUTES.page('en', 'faq')).toBe('/en/pages/faq');
    });

    it('accepts a slash-prefixed CMS slug and emits a single slash', () => {
      expect(APP_ROUTES.page('en', '/contact')).toBe('/en/pages/contact');
    });

    it('encodes URL-reserved characters in the slug segment', () => {
      expect(APP_ROUTES.page('en', 'a b')).toBe('/en/pages/a%20b');
    });
  });

  describe('error', () => {
    it('builds /error for both locales', () => {
      expect(APP_ROUTES.error('fr')).toBe('/fr/error');
      expect(APP_ROUTES.error('en')).toBe('/en/error');
    });
  });
});

describe('POLICY_SLUGS / isPolicySlug', () => {
  it('contains exactly the four allowlisted slugs', () => {
    expect(POLICY_SLUGS).toEqual(['privacy', 'returns', 'terms', 'shipping']);
  });

  it('isPolicySlug accepts allowlisted values', () => {
    expect(isPolicySlug('privacy')).toBe(true);
    expect(isPolicySlug('returns')).toBe(true);
    expect(isPolicySlug('terms')).toBe(true);
    expect(isPolicySlug('shipping')).toBe(true);
  });

  it('isPolicySlug rejects unknown values', () => {
    expect(isPolicySlug('cookies')).toBe(false);
    expect(isPolicySlug('about')).toBe(false);
    expect(isPolicySlug('')).toBe(false);
    expect(isPolicySlug(null)).toBe(false);
    expect(isPolicySlug(undefined)).toBe(false);
  });
});

describe('cmsPageRoute', () => {
  it('routes the five legacy CMS slugs to their canonical dedicated routes', () => {
    expect(cmsPageRoute('en', '/about')).toBe('/en/about');
    expect(cmsPageRoute('en', '/privacy-policy')).toBe('/en/policies/privacy');
    expect(cmsPageRoute('en', '/return-policy')).toBe('/en/policies/returns');
    expect(cmsPageRoute('en', '/terms')).toBe('/en/policies/terms');
    expect(cmsPageRoute('en', '/shipping-info')).toBe('/en/policies/shipping');
  });

  it('keeps the legacy mapping under the fr locale', () => {
    expect(cmsPageRoute('fr', '/about')).toBe('/fr/about');
    expect(cmsPageRoute('fr', '/shipping-info')).toBe('/fr/policies/shipping');
  });

  it('routes every other slug through the generic pages route', () => {
    expect(cmsPageRoute('en', '/faq')).toBe('/en/pages/faq');
    expect(cmsPageRoute('fr', '/contact')).toBe('/fr/pages/contact');
  });

  it('tolerates a slug stored without the leading slash', () => {
    expect(cmsPageRoute('en', 'faq')).toBe('/en/pages/faq');
    expect(cmsPageRoute('en', 'about')).toBe('/en/about');
  });
});

describe('LEGACY_CMS_SLUGS / isLegacyCmsSlug', () => {
  it('lists exactly the five CMS slugs that already own a dedicated route', () => {
    expect([...LEGACY_CMS_SLUGS]).toEqual([
      'about',
      'privacy-policy',
      'return-policy',
      'terms',
      'shipping-info',
    ]);
  });

  it('matches with or without the stored leading slash', () => {
    expect(isLegacyCmsSlug('about')).toBe(true);
    expect(isLegacyCmsSlug('/about')).toBe(true);
    expect(isLegacyCmsSlug('faq')).toBe(false);
    expect(isLegacyCmsSlug('/faq')).toBe(false);
  });
});

/**
 * The public track surface moved off `/account/orders/:id/track` at plan M
 * phase M3 (findings K9, K10). It is not an account route: the lookup is
 * public behind an email challenge, so a customer who lost their session can
 * still follow an order.
 */
describe('APP_ROUTES.track', () => {
  it('builds the bare locale-prefixed track path', () => {
    expect(APP_ROUTES.track('fr')).toBe('/fr/track');
    expect(APP_ROUTES.track('en')).toBe('/en/track');
  });

  it('keeps the path bare so routerLink cannot percent-encode a query string', () => {
    expect(APP_ROUTES.track('en')).not.toContain('?');
  });

  it('names the prefill query parameter once, for both reader and linkers', () => {
    expect(TRACK_ORDER_QUERY_PARAM).toBe('order');
  });

  it('no longer exposes a track route under account', () => {
    expect('track' in APP_ROUTES.account).toBe(false);
  });
});
