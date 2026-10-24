import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import {
  TranslatableInterceptor,
  parseLocale,
  resolveRequestLocale,
  isTranslatable,
  resolveTranslatables,
} from './translatable.interceptor';
import { staticLocaleSource, storeLocales } from '../locale/store-locales';

const GULF = staticLocaleSource(['ar', 'en'], 'ar', ['ar']);
const MAGHREB = staticLocaleSource(['fr', 'en'], 'fr');

afterEach(() => {
  // Every spec below that relies on the process snapshot resets it to the
  // neutral set, so an assertion never depends on test order.
  storeLocales.set({
    supportedLocales: ['fr', 'en'],
    defaultLocale: 'fr',
    rtlLocales: [],
    timezone: 'UTC',
  });
});

// ── resolveRequestLocale ─────────────────────────────────────────────────────

/**
 * `X-Locale` exists because a browser will not let a page set
 * `Accept-Language`. It is a forbidden header name in the Fetch standard;
 * Chromium relaxed that, WebKit did not. So the storefront's client-side calls
 * carried the phone's language on Safari no matter what the shop was set to,
 * and a French customer with an English iPhone read English product text.
 */
describe('resolveRequestLocale', () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers });

  it('prefers X-Locale over Accept-Language', () => {
    expect(resolveRequestLocale(req({ 'x-locale': 'fr', 'accept-language': 'en-US' }))).toBe('fr');
    expect(resolveRequestLocale(req({ 'x-locale': 'en', 'accept-language': 'fr-TN' }))).toBe('en');
  });

  it('falls back to Accept-Language when X-Locale is absent, so SSR is unchanged', () => {
    expect(resolveRequestLocale(req({ 'accept-language': 'fr-TN,en;q=0.8' }))).toBe('fr');
  });

  it('falls back when X-Locale is present but empty or blank', () => {
    expect(resolveRequestLocale(req({ 'x-locale': '', 'accept-language': 'fr' }))).toBe('fr');
    expect(resolveRequestLocale(req({ 'x-locale': '   ', 'accept-language': 'fr' }))).toBe('fr');
  });

  it('does not fall through when X-Locale names something unsupported', () => {
    // A caller that stated a preference gets that preference resolved by the
    // normal rules. Falling back to Accept-Language here would hand it a
    // different answer than it asked for, silently.
    expect(resolveRequestLocale(req({ 'x-locale': 'de', 'accept-language': 'fr' }))).not.toBe('fr');
  });

  it('reads the first value when a header arrives repeated', () => {
    expect(resolveRequestLocale(req({ 'x-locale': ['fr', 'en'] }))).toBe('fr');
    expect(resolveRequestLocale(req({ 'accept-language': ['fr', 'en'] }))).toBe('fr');
  });

  it('returns "default" when neither header is present', () => {
    expect(resolveRequestLocale(req({}))).toBe('default');
  });
});

// ── parseLocale ──────────────────────────────────────────────────────────────

describe('parseLocale', () => {
  it('returns "default" when header is undefined', () => {
    expect(parseLocale(undefined)).toBe('default');
  });

  it('returns "default" when header is empty string', () => {
    expect(parseLocale('')).toBe('default');
  });

  it('parses a simple language tag', () => {
    expect(parseLocale('fr')).toBe('fr');
    expect(parseLocale('en')).toBe('en');
  });

  it('strips the region subtag', () => {
    expect(parseLocale('fr-QA')).toBe('fr');
    expect(parseLocale('en-US')).toBe('en');
  });

  it('strips quality values', () => {
    expect(parseLocale('fr-QA;q=0.9')).toBe('fr');
  });

  it('uses only the first locale in a comma-separated list', () => {
    expect(parseLocale('fr-QA;q=0.9,en;q=0.8')).toBe('fr');
    expect(parseLocale('en,fr')).toBe('en');
  });

  it('lowercases the result', () => {
    expect(parseLocale('FR')).toBe('fr');
  });

  it('returns a non-matching sentinel for a tag outside the supported set', () => {
    // The parser is an allowlist, not a shape check, so an unsupported tag is
    // not echoed back: that stops a stray key left in an older row (an `ar`
    // value written under a locale the store no longer enables) from being
    // selected.
    //
    // What it must NOT return is `'default'`. Every Translatable carries a
    // `default` key, so that value would satisfy the resolver's FIRST rung and
    // make the store-default rung unreachable for every unsupported locale.
    for (const tag of ['de', 'ar', 'ar-SA;q=0.9,de;q=0.8']) {
      const parsed = parseLocale(tag, ['fr', 'en']);
      expect(parsed).not.toBe('default');
      expect(parsed).not.toBe('en');
      expect(parsed).not.toBe('fr');
    }
  });

  it('takes the supported set from the argument, and from the snapshot when omitted', () => {
    expect(parseLocale('ar', ['ar', 'en'])).toBe('ar');
    expect(parseLocale('ar', ['fr', 'en'])).not.toBe('ar');
    storeLocales.set(GULF.current());
    expect(parseLocale('ar')).toBe('ar');
    expect(parseLocale('fr')).not.toBe('fr');
  });

  it('lets an unsupported tag fall through to the store default rung', () => {
    // The behavioural half of the rule above, asserted through the resolver
    // rather than through the sentinel's exact spelling. `default` and `en`
    // carry different values so only the store-default rung can produce them.
    const row = { default: 'Produit', fr: 'Produit', en: 'Product' };
    expect(resolveTranslatables(row, parseLocale('de', ['fr', 'en']), 'en')).toBe('Product');
    expect(resolveTranslatables(row, parseLocale('ar', ['fr', 'en']), 'fr')).toBe('Produit');
  });
});

// ── isTranslatable ───────────────────────────────────────────────────────────

describe('isTranslatable', () => {
  it('returns true for a valid Translatable object', () => {
    expect(isTranslatable({ default: 'Bonjour', fr: 'Bonjour', en: 'Hello' })).toBe(true);
  });

  it('returns true with only the default key', () => {
    expect(isTranslatable({ default: 'Bonjour' })).toBe(true);
  });

  it('returns false when default key is missing', () => {
    expect(isTranslatable({ fr: 'Bonjour', en: 'Hello' })).toBe(false);
  });

  it('returns false when a value is not a string', () => {
    expect(isTranslatable({ default: 'Bonjour', en: 42 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTranslatable(null)).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isTranslatable(['default', 'Bonjour'])).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isTranslatable('bonjour')).toBe(false);
  });

  it('returns false for an object without default', () => {
    expect(isTranslatable({ name: 'test', price: 100 })).toBe(false);
  });
});

// ── resolveTranslatables ─────────────────────────────────────────────────────

describe('resolveTranslatables', () => {
  const translatable = { default: 'Produit', fr: 'Produit', en: 'Product' };

  it('resolves to the requested locale', () => {
    expect(resolveTranslatables(translatable, 'fr')).toBe('Produit');
    expect(resolveTranslatables(translatable, 'en')).toBe('Product');
  });

  it('resolves the "default" sentinel to the default value', () => {
    expect(resolveTranslatables(translatable, 'default')).toBe('Produit');
  });

  it('walks the whole chain in order: requested key, then the store default, then default', () => {
    // The full contract, one assertion per rung. There is no fourth rung and
    // no locale-to-locale hop: a missing key never falls through to a locale
    // that is neither requested nor the store default.
    expect(resolveTranslatables({ default: 'D', fr: 'F', en: 'E' }, 'fr', 'en')).toBe('F');
    expect(resolveTranslatables({ default: 'D', en: 'E' }, 'fr', 'en')).toBe('E');
    expect(resolveTranslatables({ default: 'D' }, 'fr', 'en')).toBe('D');
    expect(resolveTranslatables({ default: 'D', ar: 'A', en: 'E' }, 'fr', 'ar')).toBe('A');
  });

  it('falls back to the store default when the requested key is absent', () => {
    const noFr = { default: 'Nom par defaut', en: 'English Name', ar: 'اسم' };
    expect(resolveTranslatables(noFr, 'fr', 'en')).toBe('English Name');
    expect(resolveTranslatables(noFr, 'fr', 'ar')).toBe('اسم');
  });

  it('falls back to default when neither the requested key nor the store default exists', () => {
    const frOnly = { default: 'Nom par defaut', fr: 'Nom francais' };
    expect(resolveTranslatables(frOnly, 'fr', 'en')).toBe('Nom francais');
    expect(resolveTranslatables(frOnly, 'en', 'ar')).toBe('Nom par defaut');
  });

  it('walks the chain on a three locale store', () => {
    const THREE = staticLocaleSource(['fr', 'en', 'ar'], 'fr', ['ar']);
    expect(THREE.current().supportedLocales).toEqual(['fr', 'en', 'ar']);
    const full = { default: 'D', fr: 'F', en: 'E', ar: 'A' };
    expect(resolveTranslatables(full, 'ar', 'fr')).toBe('A');
    expect(resolveTranslatables({ default: 'D', fr: 'F', en: 'E' }, 'ar', 'fr')).toBe('F');
    expect(resolveTranslatables({ default: 'D', en: 'E' }, 'ar', 'fr')).toBe('D');
    expect(resolveTranslatables(full, 'default', 'fr')).toBe('D');
  });

  it('reads the store default from the snapshot when none is passed', () => {
    storeLocales.set(GULF.current());
    expect(resolveTranslatables({ default: 'D', ar: 'A', en: 'E' }, 'fr')).toBe('A');
  });

  it('recursively resolves nested objects', () => {
    const data = { name: translatable, price: 99 };
    const result = resolveTranslatables(data, 'fr') as Record<string, unknown>;
    expect(result['name']).toBe('Produit');
    expect(result['price']).toBe(99);
  });

  it('resolves inside arrays', () => {
    const data = [{ name: translatable }, { name: translatable }];
    const result = resolveTranslatables(data, 'en') as Array<Record<string, unknown>>;
    expect(result[0]['name']).toBe('Product');
    expect(result[1]['name']).toBe('Product');
  });

  it('returns null/undefined as-is', () => {
    expect(resolveTranslatables(null, 'fr')).toBeNull();
    expect(resolveTranslatables(undefined, 'fr')).toBeUndefined();
  });

  it('returns primitives unchanged', () => {
    expect(resolveTranslatables(42, 'fr')).toBe(42);
    expect(resolveTranslatables('bonjour', 'fr')).toBe('bonjour');
    expect(resolveTranslatables(true, 'fr')).toBe(true);
  });

  it('handles deeply nested structures', () => {
    const data = {
      product: {
        name: translatable,
        variants: [{ title: { default: 'Rouge', fr: 'Rouge', en: 'Red' } }],
      },
    };
    const result = resolveTranslatables(data, 'fr') as {
      product: { name: string; variants: Array<{ title: string }> };
    };
    expect(result.product.name).toBe('Produit');
    expect(result.product.variants[0].title).toBe('Rouge');
  });
});

// ── TranslatableInterceptor (integration) ───────────────────────────────────

function makeContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(data: unknown): CallHandler {
  return { handle: () => of(data) } as CallHandler;
}

describe('TranslatableInterceptor', () => {
  let interceptor: TranslatableInterceptor;

  beforeEach(() => {
    interceptor = new TranslatableInterceptor(MAGHREB);
  });

  it('resolves against the source it was built with, under both fixtures', (done) => {
    const row = { default: 'Produit', fr: 'Produit', en: 'Product', ar: 'منتج' };
    const gulf = new TranslatableInterceptor(GULF);
    const ctxNoHeader = makeContext({});
    gulf.intercept(ctxNoHeader, makeHandler({ name: row })).subscribe((noHeader) => {
      // No preference stated: the `default` key, whatever the store default is.
      expect((noHeader as Record<string, unknown>)['name']).toBe('Produit');
      const ctxUnsupported = makeContext({ 'accept-language': 'fr' });
      gulf.intercept(ctxUnsupported, makeHandler({ name: row })).subscribe((unsupported) => {
        // `fr` is outside the gulf set, so the store default `ar` answers.
        expect((unsupported as Record<string, unknown>)['name']).toBe('منتج');
        const ctxAr = makeContext({ 'accept-language': 'ar' });
        interceptor.intercept(ctxAr, makeHandler({ name: row })).subscribe((maghreb) => {
          // `ar` is outside the maghreb set, so its store default `fr` answers.
          expect((maghreb as Record<string, unknown>)['name']).toBe('Produit');
          done();
        });
      });
    });
  });

  it('resolves translatables for Accept-Language: fr', (done) => {
    const ctx = makeContext({ 'accept-language': 'fr' });
    const handler = makeHandler({ name: { default: 'Produit', fr: 'Produit', en: 'Product' } });

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect((result as Record<string, unknown>)['name']).toBe('Produit');
      done();
    });
  });

  it('resolves translatables for Accept-Language: en', (done) => {
    const ctx = makeContext({ 'accept-language': 'en-US,en;q=0.9' });
    const handler = makeHandler({ name: { default: 'Produit', fr: 'Produit', en: 'Product' } });

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect((result as Record<string, unknown>)['name']).toBe('Product');
      done();
    });
  });

  it('returns full objects when X-Resolve-Locale: false', (done) => {
    const translatable = { default: 'Produit', fr: 'Produit', en: 'Product' };
    const ctx = makeContext({ 'x-resolve-locale': 'false' });
    const handler = makeHandler({ name: translatable });

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect((result as Record<string, unknown>)['name']).toEqual(translatable);
      done();
    });
  });

  it('falls back to default when no Accept-Language header', (done) => {
    const ctx = makeContext({});
    const handler = makeHandler({ name: { default: 'Produit', fr: 'Produit', en: 'Product' } });

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect((result as Record<string, unknown>)['name']).toBe('Produit');
      done();
    });
  });

  it('falls through to the store default rung for an unsupported Accept-Language', (done) => {
    const ctx = makeContext({ 'accept-language': 'de-DE' });
    const handler = makeHandler({ name: { default: 'Produit', fr: 'Produit', en: 'Product' } });

    // `de` is outside the supported set. It must still traverse all three
    // rungs and land on the store default, `en` for this source. `default`
    // and `fr` deliberately carry the same value here, so a regression that
    // short-circuits the first rung cannot pass by accident: only the
    // store-default rung yields 'Product'.
    const englishDefault = new TranslatableInterceptor(staticLocaleSource(['fr', 'en'], 'en'));
    englishDefault.intercept(ctx, handler).subscribe((result) => {
      expect((result as Record<string, unknown>)['name']).toBe('Product');
      done();
    });
  });

  it('does not select a stray locale key left in an older row', (done) => {
    const ctx = makeContext({ 'accept-language': 'ar' });
    const handler = makeHandler({ name: { default: 'Produit', en: 'Product', ar: 'منتج' } });

    // This is what the allowlist buys. `ar` is not enabled on this store, but
    // a row written while it was can still carry the key. Without the
    // allowlist the resolver would match it and serve Arabic on a store that
    // has no Arabic locale; with it, the request falls through to the store
    // default, `en` for this source.
    const englishDefault = new TranslatableInterceptor(staticLocaleSource(['fr', 'en'], 'en'));
    englishDefault.intercept(ctx, handler).subscribe((result) => {
      expect((result as Record<string, unknown>)['name']).toBe('Product');
      done();
    });
  });
});
