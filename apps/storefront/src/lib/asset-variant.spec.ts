import { describe, it, expect } from 'vitest';

import {
  ASSET_VARIANT_NAMES,
  INTENT_TO_VARIANT,
  buildPictureSources,
  pickVariant,
  type AssetIntent,
  type AssetVariants,
} from './asset-variant';

function makePair(width: number) {
  return {
    webp: {
      url: `https://cdn.example.com/v-${width}.webp`,
      storagePath: `assets/x/${width}.webp`,
      width,
      height: Math.round(width * 0.75),
      size: width * 100,
    },
    avif: {
      url: `https://cdn.example.com/v-${width}.avif`,
      storagePath: `assets/x/${width}.avif`,
      width,
      height: Math.round(width * 0.75),
      size: width * 90,
    },
  };
}

const FIXTURE: AssetVariants = {
  thumbnail: makePair(150),
  small: makePair(400),
  medium: makePair(800),
  large: makePair(1200),
};

describe('asset-variant / pickVariant', () => {
  it.each<[AssetIntent, number]>([
    ['thumbnail', 150],
    ['card', 400],
    ['banner', 800],
    ['hero', 1200],
    ['detail', 1200],
  ])('returns the canonical webp variant for intent=%s (width=%i)', (intent, expectedWidth) => {
    const picked = pickVariant(FIXTURE, intent);
    expect(picked).not.toBeNull();
    expect(picked!.format).toBe('webp');
    expect(picked!.width).toBe(expectedWidth);
    expect(picked!.url).toBe(`https://cdn.example.com/v-${expectedWidth}.webp`);
  });

  it('exposes the full responsive srcset across formats + widths', () => {
    const picked = pickVariant(FIXTURE, 'card');
    expect(picked!.srcset).toHaveLength(ASSET_VARIANT_NAMES.length * 2);
    const widths = new Set(picked!.srcset.map((e) => e.width));
    expect(widths).toEqual(new Set([150, 400, 800, 1200]));
    const formats = new Set(picked!.srcset.map((e) => e.format));
    expect(formats).toEqual(new Set(['webp', 'avif']));
  });

  it('returns null when variants payload is absent', () => {
    expect(pickVariant(null, 'card')).toBeNull();
    expect(pickVariant(undefined, 'card')).toBeNull();
    expect(pickVariant({}, 'card')).toBeNull();
  });

  it('returns null when canonical variant for intent is missing', () => {
    const partial = { thumbnail: FIXTURE.thumbnail };
    // 'card' resolves to 'small' which is missing here.
    expect(pickVariant(partial, 'card')).toBeNull();
  });

  it('intent map is bit-for-bit identical to the backend resolver', () => {
    expect(INTENT_TO_VARIANT).toEqual({
      thumbnail: 'thumbnail',
      card: 'small',
      banner: 'medium',
      hero: 'large',
      detail: 'large',
    });
  });
});

describe('asset-variant / pictureSourcesFromAssetVariants', () => {
  const FLAT = [
    { url: 'https://cdn.example.com/v-150.webp', width: 150, format: 'webp' as const },
    { url: 'https://cdn.example.com/v-150.avif', width: 150, format: 'avif' as const },
    { url: 'https://cdn.example.com/v-400.webp', width: 400, format: 'webp' as const },
    { url: 'https://cdn.example.com/v-400.avif', width: 400, format: 'avif' as const },
    { url: 'https://cdn.example.com/v-800.webp', width: 800, format: 'webp' as const },
    { url: 'https://cdn.example.com/v-800.avif', width: 800, format: 'avif' as const },
    { url: 'https://cdn.example.com/v-1200.webp', width: 1200, format: 'webp' as const },
    { url: 'https://cdn.example.com/v-1200.avif', width: 1200, format: 'avif' as const },
  ];

  it('emits avif-then-webp source ladder + threads sizes', async () => {
    const { pictureSourcesFromAssetVariants } = await import('./asset-variant');
    const sources = pictureSourcesFromAssetVariants(FLAT, '50vw');
    expect(sources).toHaveLength(2);
    expect(sources[0]!.type).toBe('image/avif');
    expect(sources[0]!.srcset).toContain('150w');
    expect(sources[0]!.srcset).toContain('1200w');
    expect(sources[0]!.sizes).toBe('50vw');
    expect(sources[1]!.type).toBe('image/webp');
    expect(sources[1]!.sizes).toBe('50vw');
  });

  it('returns [] when payload is missing or empty', async () => {
    const { pictureSourcesFromAssetVariants } = await import('./asset-variant');
    expect(pictureSourcesFromAssetVariants(undefined)).toEqual([]);
    expect(pictureSourcesFromAssetVariants([])).toEqual([]);
    expect(pictureSourcesFromAssetVariants(null)).toEqual([]);
  });

  it('skips malformed entries', async () => {
    const { pictureSourcesFromAssetVariants } = await import('./asset-variant');
    const sources = pictureSourcesFromAssetVariants([
      { url: 'a', width: 1, format: 'webp' },
      { url: 'b', width: 2 }, // missing format
      { width: 3, format: 'webp' }, // missing url
      'string', // not an object
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.type).toBe('image/webp');
    expect(sources[0]!.srcset).toBe('a 1w');
  });
});

describe('asset-variant / buildPictureSources', () => {
  it('emits avif before webp + a srcset per width', () => {
    const sources = buildPictureSources(FIXTURE);
    expect(sources).toHaveLength(2);
    expect(sources[0]!.type).toBe('image/avif');
    expect(sources[1]!.type).toBe('image/webp');
    expect(sources[0]!.srcset).toContain('150w');
    expect(sources[0]!.srcset).toContain('1200w');
    expect(sources[1]!.srcset).toContain('150w');
  });

  it('threads the sizes attribute when provided', () => {
    const sources = buildPictureSources(FIXTURE, '(max-width: 768px) 100vw, 50vw');
    expect(sources[0]!.sizes).toBe('(max-width: 768px) 100vw, 50vw');
    expect(sources[1]!.sizes).toBe('(max-width: 768px) 100vw, 50vw');
  });

  it('returns an empty array when variants payload is missing', () => {
    expect(buildPictureSources(null)).toEqual([]);
    expect(buildPictureSources({})).toEqual([]);
  });
});
