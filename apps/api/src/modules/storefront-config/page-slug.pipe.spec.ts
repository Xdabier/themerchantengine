import { BadRequestException } from '@nestjs/common';
import { PageSlugPipe } from './page-slug.pipe';

describe('PageSlugPipe', () => {
  let pipe: PageSlugPipe;

  beforeEach(() => {
    pipe = new PageSlugPipe();
  });

  it.each(['home', 'a', 'sale-2026', 'home-essentials', '0', 'a1b2c3', 'page-with-many-hyphens'])(
    'passes through valid kebab slug "%s"',
    (slug) => {
      expect(pipe.transform(slug)).toBe(slug);
    },
  );

  it('rejects an empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('rejects a slug containing whitespace', () => {
    expect(() => pipe.transform('Home Page')).toThrow(BadRequestException);
  });

  it('rejects an uppercase slug', () => {
    expect(() => pipe.transform('Home')).toThrow(BadRequestException);
  });

  it('rejects a slug with special characters', () => {
    expect(() => pipe.transform('home!')).toThrow(BadRequestException);
  });

  it('rejects a slug with a leading hyphen', () => {
    expect(() => pipe.transform('-home')).toThrow(BadRequestException);
  });

  it('rejects a slug with a trailing hyphen', () => {
    expect(() => pipe.transform('home-')).toThrow(BadRequestException);
  });

  it('rejects a slug exceeding 64 characters', () => {
    expect(() => pipe.transform('a'.repeat(65))).toThrow(BadRequestException);
  });

  it('accepts a slug at the 64-character boundary', () => {
    const max = 'a'.repeat(64);
    expect(pipe.transform(max)).toBe(max);
  });

  it('rejects a single-character hyphen slug', () => {
    expect(() => pipe.transform('-')).toThrow(BadRequestException);
  });

  it('rejects a slug containing a forward slash', () => {
    expect(() => pipe.transform('home/featured')).toThrow(BadRequestException);
  });
});
