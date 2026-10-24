import { describe, expect, it } from 'vitest';

import type { PictureSource } from '../app/ui/picture.component';

import { buildBackgroundImageSet } from './css-image-set';

describe('buildBackgroundImageSet', () => {
  it('returns null when both arguments are empty', () => {
    expect(buildBackgroundImageSet(undefined, null)).toBeNull();
    expect(buildBackgroundImageSet([], null)).toBeNull();
    expect(buildBackgroundImageSet(undefined, '')).toBeNull();
  });

  it('serialises a single-format fallback when only fallbackUrl is provided', () => {
    expect(buildBackgroundImageSet(undefined, '/brand/default/logo.svg')).toBe(
      'image-set(url("/brand/default/logo.svg"))',
    );
  });

  it('serialises the full avif + webp + png ladder', () => {
    const sources: PictureSource[] = [
      {
        type: 'image/avif',
        srcset: '/img-400.avif 400w, /img-800.avif 800w, /img-1600.avif 1600w',
      },
      {
        type: 'image/webp',
        srcset: '/img-400.webp 400w, /img-800.webp 800w, /img-1600.webp 1600w',
      },
    ];
    expect(buildBackgroundImageSet(sources, '/img-1600.png')).toBe(
      [
        'image-set(',
        'url("/img-1600.avif") type("image/avif"), ',
        'url("/img-1600.webp") type("image/webp"), ',
        'url("/img-1600.png")',
        ')',
      ].join(''),
    );
  });

  it('maps each source type into the matching type() declaration', () => {
    const sources: PictureSource[] = [
      { type: 'image/jpeg', srcset: '/img.jpg 800w' },
      { type: 'image/png', srcset: '/img.png 800w' },
    ];
    const declaration = buildBackgroundImageSet(sources, null);
    expect(declaration).toContain('type("image/jpeg")');
    expect(declaration).toContain('type("image/png")');
  });

  it('picks the largest width per format from the srcset', () => {
    const sources: PictureSource[] = [
      { type: 'image/avif', srcset: '/a-150.avif 150w, /a-2400.avif 2400w, /a-800.avif 800w' },
    ];
    expect(buildBackgroundImageSet(sources, null)).toBe(
      'image-set(url("/a-2400.avif") type("image/avif"))',
    );
  });

  it('handles a srcset with a single entry and no width descriptor', () => {
    const sources: PictureSource[] = [{ type: 'image/webp', srcset: '/single.webp' }];
    expect(buildBackgroundImageSet(sources, null)).toBe(
      'image-set(url("/single.webp") type("image/webp"))',
    );
  });

  it('skips sources whose srcset is empty', () => {
    const sources: PictureSource[] = [
      { type: 'image/avif', srcset: '' },
      { type: 'image/webp', srcset: '/ok.webp 800w' },
    ];
    expect(buildBackgroundImageSet(sources, '/ok.png')).toBe(
      'image-set(url("/ok.webp") type("image/webp"), url("/ok.png"))',
    );
  });

  it('escapes embedded double quotes inside URLs', () => {
    const sources: PictureSource[] = [{ type: 'image/png', srcset: '/weird"name.png 400w' }];
    expect(buildBackgroundImageSet(sources, null)).toBe(
      'image-set(url("/weird\\"name.png") type("image/png"))',
    );
  });

  it('returns only the fallback when sources is an empty array', () => {
    expect(buildBackgroundImageSet([], '/img.png')).toBe('image-set(url("/img.png"))');
  });
});
