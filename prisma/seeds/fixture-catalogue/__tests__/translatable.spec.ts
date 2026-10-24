import { describe, it, expect } from 'vitest';
import { localized } from '../lib/translatable';
import { registerScratchLocale } from '../../../../libs/shared/common/src/locale/test-locale-sets';
import { LOCALE_REGISTRY } from '../../../../libs/shared/common/src/locale/locale-registry';

describe('localized seed helper', () => {
  it('builds {default, ...every registry locale} from a locale map', () => {
    const v = localized({ en: 'Electronics', fr: 'Électronique', ar: 'إلكترونيات' });
    expect(v).toEqual({
      default: 'Electronics',
      en: 'Electronics',
      fr: 'Électronique',
      ar: 'إلكترونيات',
    });
  });

  it('rejects an empty value for any registry locale (constitution §3.2)', () => {
    for (const code of Object.keys(LOCALE_REGISTRY)) {
      const map: Record<string, string> = { en: 'Audio', fr: 'Audio', ar: 'صوتيات' };
      map[code] = '   ';
      expect(() => localized(map)).toThrow(new RegExp(`Translatable\\.${code} must be non-empty`));
    }
  });

  it('rejects a map that misses a registry locale', () => {
    expect(() => localized({ en: 'Audio', fr: 'Audio' })).toThrow(
      /Translatable\.ar must be non-empty/,
    );
  });

  it('rejects a key that is not in the registry', () => {
    expect(() => localized({ en: 'Audio', fr: 'Audio', ar: 'صوتيات', xx: 'Audio' })).toThrow(
      /unknown locale "xx"/,
    );
  });

  it('canary: a newly registered locale makes the old three-key map fail', () => {
    const restore = registerScratchLocale('zz', 'ltr');
    try {
      expect(() => localized({ en: 'Audio', fr: 'Audio', ar: 'صوتيات' })).toThrow(
        /Translatable\.zz must be non-empty/,
      );
    } finally {
      restore();
    }
  });
});
