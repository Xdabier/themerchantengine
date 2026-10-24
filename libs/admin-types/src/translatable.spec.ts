import { emptyTranslatable, pickTranslation, translatableSchema } from './translatable';

describe('translatable', () => {
  it('validates a minimum object with only `default`', () => {
    expect(translatableSchema.safeParse({ default: 'Hello' }).success).toBe(true);
  });

  it('validates with locale keys', () => {
    const parsed = translatableSchema.safeParse({ default: 'Bonjour', fr: 'Bonjour', en: 'Hello' });
    expect(parsed.success).toBe(true);
  });

  it('rejects a missing `default`', () => {
    expect(translatableSchema.safeParse({ en: 'Hello' }).success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(translatableSchema.safeParse({ default: 'ok', fr: 42 }).success).toBe(false);
  });

  it('emptyTranslatable seeds `default` only', () => {
    expect(emptyTranslatable()).toEqual({ default: '' });
    expect(emptyTranslatable('Hi')).toEqual({ default: 'Hi' });
  });
});

/** A store default locale no fixture carries, so it never hides the ladder under test. */
const NO_DEFAULT = 'xx';

describe('pickTranslation', () => {
  it('returns the preferred locale when present', () => {
    expect(
      pickTranslation({ default: 'Salut', fr: 'Bonjour', en: 'Hello' }, 'fr', '', NO_DEFAULT),
    ).toBe('Bonjour');
  });

  it('falls back to default when the locale is missing', () => {
    expect(pickTranslation({ default: 'Hello' }, 'fr', '', NO_DEFAULT)).toBe('Hello');
  });

  it('accepts a plain string (resolved) value', () => {
    expect(pickTranslation('Already resolved', 'en', '', NO_DEFAULT)).toBe('Already resolved');
  });

  it('returns empty string for null / undefined', () => {
    expect(pickTranslation(null, 'en', '', NO_DEFAULT)).toBe('');
    expect(pickTranslation(undefined, 'en', '', NO_DEFAULT)).toBe('');
  });

  it('honours a custom fallback for null / undefined', () => {
    expect(pickTranslation(null, 'en', '—', NO_DEFAULT)).toBe('—');
    expect(pickTranslation({ default: '' }, 'en', '—', NO_DEFAULT)).toBe('—');
  });

  it('falls back to `default` before any other locale when the locale key is absent', () => {
    expect(pickTranslation({ default: 'D', en: 'English' }, 'de', '', NO_DEFAULT)).toBe('D');
  });

  it('does not favour a hardcoded locale when the default is empty', () => {
    expect(pickTranslation({ default: '', ar: 'مرحبا', en: 'English' }, 'fr', '', NO_DEFAULT)).toBe(
      'مرحبا',
    );
  });

  it('falls back to the first populated locale when neither locale nor default match', () => {
    expect(pickTranslation({ default: '', fr: 'Bonjour' }, 'de', '', NO_DEFAULT)).toBe('Bonjour');
  });

  it('reads the store default locale before `default` when they differ', () => {
    expect(pickTranslation({ default: 'D', fr: 'Bonjour' }, 'de', '', 'fr')).toBe('Bonjour');
  });

  it('skips empty-string locale values', () => {
    expect(pickTranslation({ default: 'D', de: '' }, 'de', '', NO_DEFAULT)).toBe('D');
  });
});
