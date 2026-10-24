import { describe, it, expect } from 'vitest';
import { assetVariantEntrySchema, assetVariantsArraySchema } from './asset-variants';

describe('assetVariantEntrySchema', () => {
  it('accepts a canonical entry', () => {
    expect(
      assetVariantEntrySchema.parse({
        url: 'https://cdn.example.com/assets/abc/large.webp',
        width: 1200,
        format: 'webp',
      }),
    ).toEqual({
      url: 'https://cdn.example.com/assets/abc/large.webp',
      width: 1200,
      format: 'webp',
    });
  });

  it('accepts both webp and avif as format', () => {
    expect(
      assetVariantEntrySchema.safeParse({ url: 'https://x/a.webp', width: 1, format: 'webp' })
        .success,
    ).toBe(true);
    expect(
      assetVariantEntrySchema.safeParse({ url: 'https://x/a.avif', width: 1, format: 'avif' })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown format', () => {
    expect(
      assetVariantEntrySchema.safeParse({
        url: 'https://x/a.jxl',
        width: 1,
        format: 'jxl' as 'webp',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-positive width', () => {
    expect(
      assetVariantEntrySchema.safeParse({ url: 'https://x/a.webp', width: 0, format: 'webp' })
        .success,
    ).toBe(false);
    expect(
      assetVariantEntrySchema.safeParse({ url: 'https://x/a.webp', width: -1, format: 'webp' })
        .success,
    ).toBe(false);
  });

  it('rejects an empty url string', () => {
    expect(assetVariantEntrySchema.safeParse({ url: '', width: 100, format: 'webp' }).success).toBe(
      false,
    );
  });
});

describe('assetVariantsArraySchema', () => {
  it('accepts an empty array (PROCESSING / no-variants asset)', () => {
    expect(assetVariantsArraySchema.parse([])).toEqual([]);
  });

  it('accepts a typical 8-entry srcset (4 widths × 2 formats)', () => {
    const widths = [150, 400, 800, 1200];
    const entries = widths.flatMap((width) => [
      { url: `https://cdn.example.com/x/${width}.webp`, width, format: 'webp' as const },
      { url: `https://cdn.example.com/x/${width}.avif`, width, format: 'avif' as const },
    ]);
    expect(assetVariantsArraySchema.parse(entries)).toEqual(entries);
  });

  it('rejects a non-array root', () => {
    expect(assetVariantsArraySchema.safeParse({} as []).success).toBe(false);
    expect(assetVariantsArraySchema.safeParse(null as unknown as []).success).toBe(false);
  });

  it('rejects when any entry is malformed', () => {
    expect(
      assetVariantsArraySchema.safeParse([
        { url: 'https://x/a.webp', width: 1200, format: 'webp' },
        { url: '', width: 0, format: 'jxl' },
      ]).success,
    ).toBe(false);
  });
});
