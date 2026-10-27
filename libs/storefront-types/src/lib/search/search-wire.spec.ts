import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { productSummarySchema } from '../shared/entities';
import { searchHitSchema } from './search.schemas';

/**
 * The `GET /v1/search` wire contract, checked against a real captured body.
 *
 * WHY A CAPTURED BODY. The only `searchHitSchema` test that existed before this
 * one parsed `{ product: { id, slug, name } }` and asserted that nothing threw.
 * It was green for every day the schema declared `priceMin` while the serializer
 * sent `minPrice`, because a hand-built fixture agrees with the schema by
 * construction. That drift reached production as `0,000 DT` on every search card.
 *
 * WHY THE ASSERTION IS A KEY-SET COMPARISON AND NOT A VALUE CHECK.
 * `productSummarySchema` ends in `.passthrough()`, so an undeclared `minPrice`
 * survives `.parse()` untouched and `parsed.product.minPrice` reads back fine at
 * runtime even when the schema has never heard of the field. A value assertion is
 * therefore green on the broken tree. What the drift actually breaks is the
 * *declared* shape: the field is not on the type, so no reader can see it, and
 * `toCardData` fell through to a literal `0`. The declared key set is the thing
 * to pin.
 *
 * Fixture provenance and the re-capture command live in `__fixtures__/README.md`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '..', '..', '..', '..', '..');

const CAPTURE_PATH = resolve(HERE, '__fixtures__', 'v1-search-lampe.captured.json');
const SERIALIZER_PATH = resolve(
  WORKSPACE_ROOT,
  'apps',
  'api',
  'src',
  'modules',
  'search',
  'search.service.ts',
);

const RECAPTURE_HINT =
  'Re-capture it with the command in ' +
  'libs/storefront-types/src/lib/search/__fixtures__/README.md';

interface CapturedBody {
  data: Array<{ product: Record<string, unknown> }>;
  meta?: { total?: number };
}

const captured = JSON.parse(readFileSync(CAPTURE_PATH, 'utf8')) as CapturedBody;

/**
 * The member names of `interface ProductSearchResult` in the API's search
 * serializer, read as text.
 *
 * A filesystem read rather than an import: importing across the app boundary
 * would pull NestJS into a types-only lib and trip module boundaries, and a
 * `import type` is erased before it can be checked at runtime. Same idiom as
 * `apps/api/src/common/customer-serializer-guard.spec.ts`, which reads
 * `schema.prisma` by path.
 */
function serializerFieldNames(): string[] {
  const source = readFileSync(SERIALIZER_PATH, 'utf8');
  const start = source.indexOf('export interface ProductSearchResult {');
  if (start === -1) {
    throw new Error(
      `interface ProductSearchResult is gone from ${SERIALIZER_PATH}. This spec pins the ` +
        'search wire against it, so it has to be pointed at whatever replaced it.',
    );
  }

  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source
    .slice(source.indexOf('{', start) + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // Collapse nested object literals (`primaryAsset: { ... } | null`, the
  // `Array<{ ... }>` in `categories`) so their inner members cannot be mistaken
  // for top-level ones.
  let flat = body;
  let previous = '';
  while (flat !== previous) {
    previous = flat;
    flat = flat.replace(/\{[^{}]*\}/g, '~');
  }

  return [...flat.matchAll(/(?:^|[;{])\s*([A-Za-z_$][\w$]*)\s*\??\s*:/g)].map((m) => m[1]);
}

describe('GET /v1/search wire contract', () => {
  const hits = captured.data ?? [];
  const productKeys = Object.keys(hits[0]?.product ?? {});
  const declaredKeys = Object.keys(searchHitSchema.shape.product.shape);

  it('the capture is a real populated search response', () => {
    // Non-vacuity. Every assertion below compares key sets, and an empty or
    // truncated capture makes all of them pass on nothing.
    expect(hits.length).toBeGreaterThan(0);
    expect(productKeys.length).toBeGreaterThan(8);
    expect(captured.meta?.total).toBeGreaterThan(0);
  });

  it('declares every field the API actually sends on a search hit', () => {
    const undeclared = productKeys.filter((key) => !declaredKeys.includes(key));
    expect(
      undeclared,
      'the search serializer emits these keys and the schema does not declare them, so no ' +
        'reader can see them. This is exactly the drift that rendered a literal 0 as the ' +
        'price on every search card.',
    ).toEqual([]);
  });

  it('declares no product field the API has never sent', () => {
    // `priceMin`, `priceMax` and `ratingSummary` were declared on
    // `productSummarySchema` and emitted by no endpoint in the tree. A declared
    // name that nothing sends reads like a contract and is a permanent
    // `undefined`, which is what the search page's price fallback was chained to.
    const phantoms = ['priceMin', 'priceMax', 'ratingSummary'].filter((key) =>
      Object.keys(productSummarySchema.shape).includes(key),
    );
    expect(
      phantoms,
      'productSummarySchema declares these, and no API serializer emits any of them.',
    ).toEqual([]);
  });

  it('carries the same field names as the serializer that produced it', () => {
    // The anti-staleness half. Without it the captured JSON pins the wire as of
    // capture day and keeps passing straight through the next rename.
    const serializerKeys = serializerFieldNames();
    expect(
      serializerKeys.length,
      `could not read the serializer's fields. ${RECAPTURE_HINT}`,
    ).toBeGreaterThan(10);
    expect(
      serializerKeys.filter((key) => !productKeys.includes(key)),
      `the serializer emits fields the capture does not carry, so the capture is stale. ${RECAPTURE_HINT}`,
    ).toEqual([]);
    expect(
      productKeys.filter((key) => !serializerKeys.includes(key)),
      `the capture carries fields the serializer no longer emits, so the capture is stale. ${RECAPTURE_HINT}`,
    ).toEqual([]);
  });

  it('lands minPrice, avgRating and reviewCount on the typed object', () => {
    // The reader-facing half: what `toCardData` in the search page actually
    // consumes. It cannot carry the signal on its own, because passthrough would
    // smuggle these through even undeclared, so it is stated after the key-set
    // checks rather than instead of them.
    const priced = hits.find((hit) => typeof hit.product['minPrice'] === 'number');
    expect(
      priced,
      `no hit in the capture carries a numeric minPrice. ${RECAPTURE_HINT}`,
    ).toBeDefined();

    const parsed = searchHitSchema.parse(priced);
    expect(typeof parsed.product.minPrice).toBe('number');
    expect(Number(parsed.product.minPrice)).toBeGreaterThan(0);
    expect(typeof parsed.product.avgRating).toBe('number');
    expect(typeof parsed.product.reviewCount).toBe('number');
  });

  it('sends no variants on a search hit, so no reader may price from one', () => {
    // The other half of the same defect: the search page's first price branch
    // read `variants[0].price`, which a search hit has never carried.
    for (const hit of hits) {
      expect(hit.product['variants']).toBeUndefined();
    }
  });
});
