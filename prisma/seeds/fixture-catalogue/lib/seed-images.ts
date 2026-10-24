import { createHash } from 'crypto';
import * as path from 'path';

/**
 * The images the fixture catalogue seeds with (plan E2.6).
 *
 * They ship inside the seed directory. Before this, every image path resolved
 * to a folder two levels above the repository root, so the imagery existed on
 * exactly one machine: everywhere else the source file was missing, the ingest
 * was skipped, and the catalogue seeded with no pictures at all while still
 * reporting success. The storefront's home sections silently seeded nothing on
 * that path, which is the seed gap the phase before this one recorded.
 *
 * Neutral tiles rather than photography: a fixture catalogue needs images that
 * exist, differ from each other, and carry nobody's brand. A visual baseline
 * can tell them apart and the whole set is under half a megabyte.
 */
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

const TILES = [
  'tile-01.png',
  'tile-02.png',
  'tile-03.png',
  'tile-04.png',
  'tile-05.png',
  'tile-06.png',
  'tile-07.png',
  'tile-08.png',
] as const;

/** The wide banner the home hero renders. */
export const HERO_BANNER_PATH = path.join(ASSETS_DIR, 'banner-hero.png');

/** The wide banner the mid-page promotional section renders. */
export const PROMO_BANNER_PATH = path.join(ASSETS_DIR, 'banner-promo.png');

/**
 * A tile for a catalogue key, chosen deterministically so the same product or
 * category gets the same picture on every machine and every re-run. Different
 * keys mostly get different tiles, which is what a grid needs to look like a
 * catalogue rather than one image repeated.
 *
 * `variant` walks the set, so a product's gallery entries land on tiles other
 * than its hero. It is a nudge and not a guarantee: two keys can still collide,
 * and the caller that joins assets to a product is what has to tolerate that.
 */
export function seedImagePath(key: string, variant = 0): string {
  const digest = createHash('sha256').update(key).digest();
  return path.join(ASSETS_DIR, TILES[(digest[0] + variant) % TILES.length]);
}
