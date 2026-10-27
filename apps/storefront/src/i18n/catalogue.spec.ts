import { describe, expect, it } from 'vitest';

import { buildCatalogues, mergeWithFallback } from './catalogue';

describe('mergeWithFallback', () => {
  it('fills a missing leaf from the fallback and keeps present ones', () => {
    const merged = mergeWithFallback(
      { a: 'x', nested: { b: 'y' } },
      { a: 'fa', c: 'fc', nested: { b: 'fb', d: 'fd' } },
    );
    expect(merged).toEqual({ a: 'x', c: 'fc', nested: { b: 'y', d: 'fd' } });
  });

  it('treats an empty string as missing', () => {
    expect(mergeWithFallback({ a: '' }, { a: 'fa' })).toEqual({ a: 'fa' });
  });

  it('does not mutate the fallback', () => {
    const fallback = { nested: { b: 'fb' } };
    mergeWithFallback({ nested: {} }, fallback);
    expect(fallback).toEqual({ nested: { b: 'fb' } });
  });
});

describe('buildCatalogues', () => {
  it('serves every registry locale', () => {
    expect(Object.keys(buildCatalogues({ fr: { a: 'x' } }, 'fr')).sort()).toEqual([
      'ar',
      'en',
      'fr',
    ]);
  });

  it('falls back per key to the default locale string', () => {
    const built = buildCatalogues(
      { fr: { a: 'fr-a', b: 'fr-b' }, en: { a: 'en-a' }, ar: {} },
      'fr',
    );
    expect(built['en']).toEqual({ a: 'en-a', b: 'fr-b' });
    expect(built['ar']).toEqual({ a: 'fr-a', b: 'fr-b' });
  });
});
