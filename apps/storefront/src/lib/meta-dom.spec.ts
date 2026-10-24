import { beforeEach, describe, expect, it } from 'vitest';

import { upsertPropertyMulti } from './meta-dom';

describe('upsertPropertyMulti', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  function contents(): string[] {
    return [...document.head.querySelectorAll('meta[property="og:locale:alternate"]')].map(
      (node) => (node as HTMLMetaElement).content,
    );
  }

  it('emits one meta per value', () => {
    upsertPropertyMulti(document, 'og:locale:alternate', ['en_TN', 'fr_TN']);
    expect(contents()).toEqual(['en_TN', 'fr_TN']);
  });

  it('replaces the previous set rather than appending to it', () => {
    upsertPropertyMulti(document, 'og:locale:alternate', ['en_TN']);
    upsertPropertyMulti(document, 'og:locale:alternate', ['fr_TN']);
    // A client-side navigation between locales must not leave both behind.
    expect(contents()).toEqual(['fr_TN']);
  });

  it('clears the property when given no values', () => {
    upsertPropertyMulti(document, 'og:locale:alternate', ['en_TN']);
    upsertPropertyMulti(document, 'og:locale:alternate', []);
    expect(contents()).toEqual([]);
  });

  it('leaves other properties alone', () => {
    const other = document.createElement('meta');
    other.setAttribute('property', 'og:locale');
    other.setAttribute('content', 'fr_TN');
    document.head.appendChild(other);

    upsertPropertyMulti(document, 'og:locale:alternate', ['en_TN']);
    expect(document.head.querySelectorAll('meta[property="og:locale"]').length).toBe(1);
  });
});
