import { describe, expect, it } from 'vitest';

import { TrailingSlashUrlSerializer } from './trailing-slash-url-serializer';

/**
 * Finding A1. `DefaultUrlSerializer.parse('/en/')` pushes the trailing slash
 * as a real EMPTY segment, which no route consumes, so the catch-all
 * not-found route wins and sign-out renders the 404 page under `/en/`.
 * These assertions pin the parse normalisation without loosening the
 * serialize contract the locale switcher depends on.
 */
describe('TrailingSlashUrlSerializer', () => {
  const serializer = new TrailingSlashUrlSerializer();

  const segments = (url: string): string[] =>
    serializer.parse(url).root.children['primary']?.segments.map((s) => s.path) ?? [];

  it('parses a locale root without an empty trailing segment', () => {
    expect(segments('/en/')).toEqual(['en']);
    expect(segments('/fr/')).toEqual(['fr']);
  });

  it('parses a locale root exactly like its slashless form', () => {
    expect(segments('/en/')).toEqual(segments('/en'));
  });

  it('keeps the trailing-slash URL contract on serialize', () => {
    expect(serializer.serialize(serializer.parse('/en/'))).toBe('/en/');
    expect(serializer.serialize(serializer.parse('/fr'))).toBe('/fr/');
  });

  it('leaves deeper paths untouched', () => {
    expect(segments('/en/catalog')).toEqual(['en', 'catalog']);
    expect(serializer.serialize(serializer.parse('/en/catalog'))).toBe('/en/catalog');
  });

  it('strips a trailing slash on a deeper path too', () => {
    expect(segments('/en/catalog/')).toEqual(['en', 'catalog']);
  });

  it('preserves query params and fragments while normalising the path', () => {
    const tree = serializer.parse('/en/?q=1');
    expect(tree.root.children['primary']?.segments.map((s) => s.path)).toEqual(['en']);
    expect(tree.queryParams).toEqual({ q: '1' });

    const withFragment = serializer.parse('/en/#reviews');
    expect(withFragment.root.children['primary']?.segments.map((s) => s.path)).toEqual(['en']);
    expect(withFragment.fragment).toBe('reviews');
  });

  it('leaves the bare root path alone', () => {
    expect(segments('/')).toEqual([]);
    expect(serializer.serialize(serializer.parse('/'))).toBe('/');
  });
});
