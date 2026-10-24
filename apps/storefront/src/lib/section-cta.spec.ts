import { describe, expect, it } from 'vitest';

import { resolveSectionCta, resolveSectionCtaOrCatalog } from './section-cta';

describe('resolveSectionCta', () => {
  it('locale-prefixes a site-relative path that carries no locale segment', () => {
    // The seeds store `/catalog`; every storefront route is locale-prefixed, so
    // rendering the stored value verbatim would 404.
    expect(resolveSectionCta('/catalog', 'fr')).toEqual({ kind: 'internal', href: '/fr/catalog' });
    expect(resolveSectionCta('/catalog', 'en')).toEqual({ kind: 'internal', href: '/en/catalog' });
  });

  it('leaves an already locale-prefixed path untouched', () => {
    expect(resolveSectionCta('/en/catalog/sidr-honey', 'fr')).toEqual({
      kind: 'internal',
      href: '/en/catalog/sidr-honey',
    });
  });

  it('resolves an absolute http(s) URL as external', () => {
    expect(resolveSectionCta('https://example.com/x', 'fr')).toEqual({
      kind: 'external',
      href: 'https://example.com/x',
    });
    expect(resolveSectionCta('http://example.com', 'en')).toEqual({
      kind: 'external',
      href: 'http://example.com',
    });
  });

  it('rejects every scheme the API allowlist rejects', () => {
    // Defense in depth over `cta-href.constants.ts`: rows written before that
    // validator landed, or through any path that bypasses the DTO.
    for (const bad of [
      'javascript:alert(1)',
      '//evil.com',
      '/\\evil.com',
      'data:text/html,x',
      'vbscript:x',
      'mailto:a@b.c',
      'catalog',
    ]) {
      expect(resolveSectionCta(bad, 'fr'), bad).toBeNull();
    }
  });

  it('rejects an absent, empty or whitespace-only href', () => {
    expect(resolveSectionCta(null, 'fr')).toBeNull();
    expect(resolveSectionCta(undefined, 'fr')).toBeNull();
    expect(resolveSectionCta('', 'fr')).toBeNull();
    expect(resolveSectionCta('   ', 'fr')).toBeNull();
  });
});

describe('resolveSectionCtaOrCatalog', () => {
  it('falls back to the locale catalogue when the href is unusable', () => {
    expect(resolveSectionCtaOrCatalog('javascript:alert(1)', 'fr')).toEqual({
      kind: 'internal',
      href: '/fr/catalog',
    });
    expect(resolveSectionCtaOrCatalog(null, 'en')).toEqual({
      kind: 'internal',
      href: '/en/catalog',
    });
  });

  it('passes a usable href straight through', () => {
    expect(resolveSectionCtaOrCatalog('/en/cart', 'fr')).toEqual({
      kind: 'internal',
      href: '/en/cart',
    });
  });
});
