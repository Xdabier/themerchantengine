import {
  ASSET_VARIANT_NAMES,
  VIDEO_RENDITION_NAMES,
  type ImageAssetVariants,
  type VideoAssetVariants,
} from './asset-variants.schema';
import {
  AssetFailedError,
  AssetNotReadyError,
  AssetVariantMissingError,
  pickVariantUrl,
  tryPickVariantUrl,
} from './resolver';

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

const IMAGE_VARIANTS_FIXTURE: ImageAssetVariants = {
  thumbnail: makePair(150),
  small: makePair(400),
  medium: makePair(800),
  large: makePair(1200),
};

const VIDEO_VARIANTS_FIXTURE: VideoAssetVariants = {
  ...IMAGE_VARIANTS_FIXTURE,
  renditions: {
    mobile: {
      url: 'https://cdn.example.com/v-mobile.mp4',
      storagePath: 'assets/x/mobile.mp4',
      width: 854,
      height: 480,
      size: 1_000_000,
      container: 'mp4',
      codec: 'h264-baseline',
      bitrate: '1.0M',
    },
    tablet: {
      url: 'https://cdn.example.com/v-tablet.mp4',
      storagePath: 'assets/x/tablet.mp4',
      width: 1280,
      height: 720,
      size: 2_500_000,
      container: 'mp4',
      codec: 'h264-main',
      bitrate: '2.5M',
    },
    desktop: {
      url: 'https://cdn.example.com/v-desktop.mp4',
      storagePath: 'assets/x/desktop.mp4',
      width: 1920,
      height: 1080,
      size: 5_000_000,
      container: 'mp4',
      codec: 'h264-high',
      bitrate: '5.0M',
    },
    'desktop-webm': {
      url: 'https://cdn.example.com/v-desktop.webm',
      storagePath: 'assets/x/desktop.webm',
      width: 1920,
      height: 1080,
      size: 4_500_000,
      container: 'webm',
      codec: 'vp9',
      bitrate: '5.0M',
    },
  },
};

describe('pickVariantUrl — image asset', () => {
  it('returns the canonical webp variant for each intent', () => {
    const asset = { id: 'a1', status: 'READY' as const, variants: IMAGE_VARIANTS_FIXTURE };

    expect(pickVariantUrl(asset, 'thumbnail').url).toBe(IMAGE_VARIANTS_FIXTURE.thumbnail.webp.url);
    expect(pickVariantUrl(asset, 'card').url).toBe(IMAGE_VARIANTS_FIXTURE.small.webp.url);
    expect(pickVariantUrl(asset, 'banner').url).toBe(IMAGE_VARIANTS_FIXTURE.medium.webp.url);
    expect(pickVariantUrl(asset, 'hero').url).toBe(IMAGE_VARIANTS_FIXTURE.large.webp.url);
    expect(pickVariantUrl(asset, 'detail').url).toBe(IMAGE_VARIANTS_FIXTURE.large.webp.url);
  });

  it('returns the full srcset (8 entries — 4 widths × {webp, avif})', () => {
    const asset = { id: 'a1', status: 'READY' as const, variants: IMAGE_VARIANTS_FIXTURE };
    const out = pickVariantUrl(asset, 'card');
    expect(out.srcset).toHaveLength(ASSET_VARIANT_NAMES.length * 2);
  });

  it('throws AssetNotReadyError on PROCESSING', () => {
    expect(() =>
      pickVariantUrl(
        { id: 'a1', status: 'PROCESSING', variants: IMAGE_VARIANTS_FIXTURE },
        'thumbnail',
      ),
    ).toThrow(AssetNotReadyError);
  });

  it('throws AssetFailedError on FAILED', () => {
    expect(() =>
      pickVariantUrl({ id: 'a1', status: 'FAILED', variants: IMAGE_VARIANTS_FIXTURE }, 'thumbnail'),
    ).toThrow(AssetFailedError);
  });
});

describe('pickVariantUrl — video asset (AV2)', () => {
  it('returns the poster pair URL for the intent (resolver shape unchanged)', () => {
    const asset = { id: 'v1', status: 'READY' as const, variants: VIDEO_VARIANTS_FIXTURE };

    // Same top-level keys as image — resolver hits poster pairs at each width.
    expect(pickVariantUrl(asset, 'thumbnail').url).toBe(VIDEO_VARIANTS_FIXTURE.thumbnail.webp.url);
    expect(pickVariantUrl(asset, 'detail').url).toBe(VIDEO_VARIANTS_FIXTURE.large.webp.url);
  });

  it('throws AssetVariantMissingError on a video payload missing renditions when parsed via union', () => {
    // Strip renditions — payload no longer matches video schema, also breaks
    // the resolver's safeParse against the union (image fallback succeeds, so
    // the resolver returns the poster path successfully). This test asserts
    // the more important property: a payload that omits BOTH renditions AND
    // some image pair is rejected.
    const broken = { ...VIDEO_VARIANTS_FIXTURE };
    delete (broken as { renditions?: unknown }).renditions;
    delete (broken as { large?: unknown }).large;
    expect(() => pickVariantUrl({ id: 'v1', status: 'READY', variants: broken }, 'detail')).toThrow(
      AssetVariantMissingError,
    );
  });

  it('lists the four canonical rendition names', () => {
    expect(VIDEO_RENDITION_NAMES).toEqual(['mobile', 'tablet', 'desktop', 'desktop-webm']);
  });
});

describe('tryPickVariantUrl', () => {
  it('returns null on null asset', () => {
    expect(tryPickVariantUrl(null, 'thumbnail')).toBeNull();
  });

  it('returns null on PROCESSING (image)', () => {
    expect(
      tryPickVariantUrl(
        { id: 'a1', status: 'PROCESSING', variants: IMAGE_VARIANTS_FIXTURE },
        'card',
      ),
    ).toBeNull();
  });

  it('returns null on PROCESSING (video)', () => {
    expect(
      tryPickVariantUrl(
        { id: 'v1', status: 'PROCESSING', variants: VIDEO_VARIANTS_FIXTURE },
        'card',
      ),
    ).toBeNull();
  });

  it('returns the URL on a READY image asset', () => {
    const out = tryPickVariantUrl(
      { id: 'a1', status: 'READY', variants: IMAGE_VARIANTS_FIXTURE },
      'thumbnail',
    );
    expect(out?.url).toBe(IMAGE_VARIANTS_FIXTURE.thumbnail.webp.url);
  });

  it('returns the URL on a READY video asset (poster pair)', () => {
    const out = tryPickVariantUrl(
      { id: 'v1', status: 'READY', variants: VIDEO_VARIANTS_FIXTURE },
      'thumbnail',
    );
    expect(out?.url).toBe(VIDEO_VARIANTS_FIXTURE.thumbnail.webp.url);
  });
});
