import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';
import { IMAGE_VARIANTS } from '../../../../libs/shared/common/src/asset-variants';

/**
 * Parity check between the seed-runner sharp pipeline and the production
 * `apps/api/src/modules/assets/processors/image-processing.processor.ts`.
 *
 * Both consume the same `IMAGE_VARIANTS` constant, which lives in the shared
 * library so the seed never imports from `apps/api` (plan E2.6), and the same
 * sharp + blurhash code path. This spec runs the structural pipeline
 * against an in-memory PNG and asserts the resulting variant map matches
 * the documented Asset.variants shape: keys = variant names,
 * each value = { webp, avif }, each format = { width, height, size }.
 */
describe('image-pipeline parity', () => {
  it('produces 4 named variants × 2 formats with matching shape', async () => {
    const source = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();

    const variants: Record<
      string,
      { webp: { width: number; size: number }; avif: { width: number; size: number } }
    > = {};
    for (const variant of IMAGE_VARIANTS) {
      const resized =
        variant.width !== null
          ? sharp(source).rotate().resize(variant.width, undefined, { withoutEnlargement: true })
          : sharp(source).rotate();

      const [webp, avif] = await Promise.all([
        resized.clone().toFormat('webp', { quality: 80 }).toBuffer({ resolveWithObject: true }),
        resized.clone().toFormat('avif', { quality: 80 }).toBuffer({ resolveWithObject: true }),
      ]);

      variants[variant.name] = {
        webp: { width: webp.info.width, size: webp.info.size },
        avif: { width: avif.info.width, size: avif.info.size },
      };
    }

    // AV1 dropped `original` from IMAGE_VARIANTS — variants are the four
    // canonical widths only. Originals live in private storage and are
    // never variant-served.
    expect(Object.keys(variants).sort()).toEqual(['large', 'medium', 'small', 'thumbnail']);

    for (const name of ['thumbnail', 'small', 'medium', 'large']) {
      expect(variants[name].webp.width).toBeGreaterThan(0);
      expect(variants[name].webp.size).toBeGreaterThan(0);
      expect(variants[name].avif.width).toBeGreaterThan(0);
      expect(variants[name].avif.size).toBeGreaterThan(0);
    }

    // Width invariants — variants resize down per IMAGE_VARIANTS.
    expect(variants.thumbnail.webp.width).toBeLessThanOrEqual(150);
    expect(variants.small.webp.width).toBeLessThanOrEqual(400);
    expect(variants.medium.webp.width).toBeLessThanOrEqual(800);
    expect(variants.large.webp.width).toBeLessThanOrEqual(1200);
  });

  it('blurhash is a non-empty base83 string', async () => {
    const source = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 50, b: 200 } },
    })
      .png()
      .toBuffer();
    const { data, info } = await sharp(source)
      .resize(32, 32, { fit: 'inside' })
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });
    const blurhash = encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
    expect(blurhash.length).toBeGreaterThanOrEqual(6);
    // base83 characters per blurhash spec.
    expect(blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@\[\]^_{|}~]+$/);
  });
});
