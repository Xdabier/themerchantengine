import { describe, expect, it } from 'vitest';

import { noImageFallback } from './no-image';

describe('noImageFallback', () => {
  it('returns the single locale-neutral placeholder', () => {
    expect(noImageFallback()).toBe('/brand/no-image.svg');
  });

  it('carries no locale in the path, so both locales resolve to the same asset', () => {
    expect(noImageFallback()).not.toMatch(/-(fr|en|ar)\./);
  });
});
