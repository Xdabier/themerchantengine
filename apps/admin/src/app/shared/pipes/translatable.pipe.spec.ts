import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { TranslatablePipe } from './translatable.pipe';

describe('TranslatablePipe', () => {
  let pipe: TranslatablePipe;
  let auth: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: BOOTSTRAP_LOCALE, useValue: 'fr' }, TranslatablePipe],
    });
    pipe = TestBed.inject(TranslatablePipe);
    auth = TestBed.inject(AuthStore);
  });

  it('reduces a Translatable object to the active locale', () => {
    auth.setLocale('fr');
    expect(pipe.transform({ default: 'Salut', fr: 'Bonjour', en: 'Hello' })).toBe('Bonjour');
  });

  it('passes a plain (already-resolved) string through unchanged', () => {
    expect(pipe.transform('Resolved')).toBe('Resolved');
  });

  it('returns the supplied fallback for null / empty input', () => {
    expect(pipe.transform(null, '—')).toBe('—');
    expect(pipe.transform({ default: '' }, '—')).toBe('—');
  });

  it('re-resolves live when the active locale changes (impure)', () => {
    const value = { default: 'Salut', fr: 'Bonjour', en: 'Hello' };
    auth.setLocale('en');
    expect(pipe.transform(value)).toBe('Hello');
    auth.setLocale('fr');
    expect(pipe.transform(value)).toBe('Bonjour');
  });

  it('reads the store default locale before `default` when the active locale is missing', () => {
    auth.setLocale('de');
    expect(pipe.transform({ default: 'D', ar: 'مرحبا' })).toBe('مرحبا');
  });

  it('memoizes when value, locale, and fallback are unchanged', () => {
    const value = { default: 'Hello', en: 'Hello' };
    const first = pipe.transform(value);
    const second = pipe.transform(value);
    expect(first).toBe(second);
    expect(second).toBe('Hello');
  });
});
