import {
  ASSET_VARIANT_NAMES,
  INTENT_TO_VARIANT,
  VIDEO_RENDITION_NAMES,
  assetVariantsSchema,
  imageAssetVariantsSchema,
  videoAssetVariantsSchema,
} from './asset-variants.schema';

function makeArtefact(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    url: 'https://cdn.example.com/v.webp',
    storagePath: 'assets/abc/large.webp',
    width: 1200,
    height: 800,
    size: 12345,
    ...overrides,
  };
}

function makeVariants(): Record<string, unknown> {
  return Object.fromEntries(
    ASSET_VARIANT_NAMES.map((name) => [name, { webp: makeArtefact(), avif: makeArtefact() }]),
  );
}

function makeRenditionArtefact(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    url: 'https://cdn.example.com/v.mp4',
    storagePath: 'assets/abc/desktop.mp4',
    width: 1920,
    height: 1080,
    size: 5_000_000,
    container: 'mp4',
    codec: 'h264-high',
    bitrate: '5.0M',
    ...overrides,
  };
}

function makeVideoVariants(): Record<string, unknown> {
  return {
    ...makeVariants(),
    renditions: {
      mobile: makeRenditionArtefact({
        width: 854,
        height: 480,
        codec: 'h264-baseline',
        bitrate: '1.0M',
      }),
      tablet: makeRenditionArtefact({
        width: 1280,
        height: 720,
        codec: 'h264-main',
        bitrate: '2.5M',
      }),
      desktop: makeRenditionArtefact(),
      'desktop-webm': makeRenditionArtefact({
        container: 'webm',
        codec: 'vp9',
        storagePath: 'assets/abc/desktop.webm',
        url: 'https://cdn.example.com/v.webm',
      }),
    },
  };
}

describe('assetVariantsSchema — image branch', () => {
  it('parses a fully-populated image variant payload', () => {
    expect(() => assetVariantsSchema.parse(makeVariants())).not.toThrow();
  });

  it('rejects when a variant name is missing', () => {
    const v = makeVariants();
    delete (v as { thumbnail?: unknown }).thumbnail;
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects when a format pair is missing', () => {
    const v = makeVariants();
    (v.large as { avif?: unknown }).avif = undefined;
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects when an artefact lacks url', () => {
    const v = makeVariants();
    (v.thumbnail as { webp: Record<string, unknown> }).webp = makeArtefact({ url: '' });
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects when width is not a number', () => {
    const v = makeVariants();
    (v.small as { avif: Record<string, unknown> }).avif = makeArtefact({ width: '400' });
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects an empty payload', () => {
    expect(() => assetVariantsSchema.parse({})).toThrow();
  });
});

describe('assetVariantsSchema — video branch (AV2)', () => {
  it('parses a fully-populated video variant payload (poster + renditions)', () => {
    expect(() => assetVariantsSchema.parse(makeVideoVariants())).not.toThrow();
  });

  it('rejects when a rendition name is missing', () => {
    const v = makeVideoVariants();
    delete (v.renditions as { mobile?: unknown }).mobile;
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects when a rendition lacks codec', () => {
    const v = makeVideoVariants();
    (v.renditions as { desktop: Record<string, unknown> }).desktop = makeRenditionArtefact({
      codec: '',
    });
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects when a rendition container is not mp4|webm', () => {
    const v = makeVideoVariants();
    (v.renditions as { mobile: Record<string, unknown> }).mobile = makeRenditionArtefact({
      container: 'mkv',
    });
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('rejects when poster pairs are missing on a video payload', () => {
    const v = makeVideoVariants();
    delete (v as { large?: unknown }).large;
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });

  it('union order routes payloads with renditions to video schema', () => {
    // Payload with renditions but malformed image pair — must error against
    // the video branch (the more-specific match), not silently fall through to
    // the image branch.
    const v = makeVideoVariants();
    (v.large as { webp: Record<string, unknown> }).webp = makeArtefact({ width: -1 });
    expect(() => assetVariantsSchema.parse(v)).toThrow();
  });
});

describe('imageAssetVariantsSchema (direct, AV2 export)', () => {
  it('parses image-only shapes', () => {
    expect(() => imageAssetVariantsSchema.parse(makeVariants())).not.toThrow();
  });
});

describe('videoAssetVariantsSchema (direct, AV2 export)', () => {
  it('parses video-only shapes', () => {
    expect(() => videoAssetVariantsSchema.parse(makeVideoVariants())).not.toThrow();
  });

  it('rejects an image-only payload (renditions required)', () => {
    expect(() => videoAssetVariantsSchema.parse(makeVariants())).toThrow();
  });
});

describe('INTENT_TO_VARIANT', () => {
  it('routes intents to the canonical variant per agent_docs §2', () => {
    expect(INTENT_TO_VARIANT.thumbnail).toBe('thumbnail');
    expect(INTENT_TO_VARIANT.card).toBe('small');
    expect(INTENT_TO_VARIANT.banner).toBe('medium');
    expect(INTENT_TO_VARIANT.hero).toBe('large');
    expect(INTENT_TO_VARIANT.detail).toBe('large');
  });
});

describe('VIDEO_RENDITION_NAMES (AV2)', () => {
  it('lists the four canonical renditions per agent_docs §5', () => {
    expect(VIDEO_RENDITION_NAMES).toEqual(['mobile', 'tablet', 'desktop', 'desktop-webm']);
  });
});
