import { describe, expect, it } from 'vitest';
import { pickTranslation, resolvedStringSchema, translatableSchema } from './translatable';

describe('translatableSchema', () => {
  it('accepts a value with default + extra locales', () => {
    expect(() =>
      translatableSchema.parse({ default: 'Bonjour', fr: 'Bonjour', en: 'Hi' }),
    ).not.toThrow();
  });

  it('rejects a value missing default', () => {
    expect(() => translatableSchema.parse({ en: 'Hi' })).toThrow();
  });
});

describe('resolvedStringSchema', () => {
  it('accepts a plain string', () => {
    expect(resolvedStringSchema.parse('Hello')).toBe('Hello');
  });

  it('accepts a Translatable object', () => {
    const value = { default: 'Bonjour', fr: 'Bonjour' };
    expect(resolvedStringSchema.parse(value)).toEqual(value);
  });

  it('rejects a number', () => {
    expect(() => resolvedStringSchema.parse(42)).toThrow();
  });
});

describe('pickTranslation', () => {
  it('returns the plain string as-is', () => {
    expect(pickTranslation('Hello', 'en')).toBe('Hello');
  });

  it('picks the preferred locale from a Translatable', () => {
    expect(pickTranslation({ default: 'Bonjour', fr: 'Bonjour', en: 'Hi' }, 'en')).toBe('Hi');
  });

  it('falls back to default when locale missing', () => {
    expect(pickTranslation({ default: 'Bonjour' }, 'en')).toBe('Bonjour');
  });

  it('returns empty string for null', () => {
    expect(pickTranslation(null, 'en')).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(pickTranslation(undefined, 'en')).toBe('');
  });
});
