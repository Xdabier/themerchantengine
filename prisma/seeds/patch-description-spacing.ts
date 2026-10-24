/**
 * Repair the missing space after a full stop, in the catalogue JSON and in
 * already-seeded rows.
 *
 * Plan H, phase H4. Findings H2 and E9. The generator fix in
 * `prices_list/*_ingest.py` only helps future enrichment, and re-seeding does
 * not help either: the catalogue seeds write with `createMany` and
 * `skipDuplicates`, so a row that already exists is never revisited. Both
 * halves need their own pass.
 *
 * Plan H called the catalogue files "committed sources". They are not:
 * `.gitignore` excludes `prices_list/*` apart from an allowlist, so
 * the `*.catalogue.json` files are working-copy
 * artifacts. `--catalogues` therefore repairs them on the machine that holds
 * them and travels nowhere. What does travel is the ingest fix, which
 * regenerates them clean, and this database pass.
 *
 *   npx ts-node prisma/seeds/patch-description-spacing.ts --catalogues
 *   npx ts-node prisma/seeds/patch-description-spacing.ts --catalogues --apply
 *   npx ts-node prisma/seeds/patch-description-spacing.ts
 *   npx ts-node prisma/seeds/patch-description-spacing.ts --apply
 *
 * Dry-run by default. This is the one script in plan H that may legitimately
 * run against production, so it carries no host allowlist. What it carries
 * instead is a narrower blast radius: it only ever inserts a space into an
 * `en` or `default` string, it never deletes, never inserts and never touches
 * a row it did not change, and every change is printed with its before and
 * after before `--apply` is allowed to write it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { fixSentenceSpacing, fixTranslatableSpacing } from './lib/sentence-spacing';

const APPLY = process.argv.includes('--apply');
const CATALOGUES = process.argv.includes('--catalogues');

const CATALOGUE_DIR = path.resolve(__dirname, '..', '..', 'prices_list');

function catalogueFiles(): string[] {
  if (!fs.existsSync(CATALOGUE_DIR)) return [];
  return fs
    .readdirSync(CATALOGUE_DIR)
    .filter((name) => name.endsWith('.catalogue.json'))
    .map((name) => path.join(CATALOGUE_DIR, name));
}

/**
 * The Translatable fields that carry prose a customer reads.
 *
 * `name` is deliberately absent: product names are short, they never contain a
 * sentence boundary, and a rule that rewrote them would be changing the thing
 * every slug, order line and invoice was built from.
 */
const PRODUCT_FIELDS = ['description', 'shortDescription', 'metaTitle', 'metaDescription'] as const;
const CATEGORY_FIELDS = ['description', 'metaDescription'] as const;

function excerpt(before: string, after: string): string {
  const at = [...before].findIndex((_, i) => before[i] !== after[i]);
  const from = Math.max(0, at - 30);
  return `      "...${before.slice(from, at + 30)}..."\n   -> "...${after.slice(from, at + 31)}..."`;
}

/**
 * Walk a parsed catalogue, repairing every `en` and `default` string in it.
 *
 * The catalogue nests Translatables inside products, categories and FAQ pairs,
 * so this recurses on the same key rule the seed helper uses rather than
 * enumerating paths that would go stale.
 */
function fixCatalogueValue(value: unknown, onChange: (b: string, a: string) => void): unknown {
  if (Array.isArray(value)) return value.map((item) => fixCatalogueValue(item, onChange));
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(source)) {
    if ((key === 'en' || key === 'default') && typeof inner === 'string') {
      const fixed = fixSentenceSpacing(inner);
      if (fixed !== inner) onChange(inner, fixed);
      next[key] = fixed;
    } else {
      next[key] = fixCatalogueValue(inner, onChange);
    }
  }
  return next;
}

function patchCatalogues(): number {
  let total = 0;
  const files = catalogueFiles();
  if (!files.length) console.log('no *.catalogue.json under prices_list, skipped');
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    let changes = 0;
    const fixed = fixCatalogueValue(JSON.parse(raw), (before, after) => {
      changes += 1;
      console.log(excerpt(before, after));
    });
    console.log(`${path.basename(file)}: ${changes} change(s)`);
    total += changes;
    if (APPLY && changes) {
      // Preserve the file's own two-space indentation and trailing newline so
      // the diff is the copy fix and nothing else.
      fs.writeFileSync(file, `${JSON.stringify(fixed, null, 2)}\n`, 'utf8');
      console.log(`  written`);
    }
  }
  return total;
}

async function patchDatabase(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('[patch-description-spacing] DATABASE_URL is not set');
  const database = new URL(url).pathname.replace(/^\//, '');
  console.log(`database: ${database}`);
  console.log('');

  const prisma = new PrismaClient({ adapter: new PrismaPg(url) });
  await prisma.$connect();
  let total = 0;

  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        slug: true,
        description: true,
        shortDescription: true,
        metaTitle: true,
        metaDescription: true,
      },
    });
    for (const row of products) {
      const data: Record<string, Prisma.InputJsonValue> = {};
      for (const field of PRODUCT_FIELDS) {
        const before = row[field];
        const after = fixTranslatableSpacing(before);
        // Identity, not deep equality: the helper returns the same reference
        // when it changed nothing, so an unchanged row issues no UPDATE.
        if (after === before) continue;
        data[field] = after as Prisma.InputJsonValue;
        const b = (before as Record<string, string>)?.en ?? '';
        const a = (after as Record<string, string>)?.en ?? '';
        console.log(`Product ${row.slug} . ${field}`);
        console.log(excerpt(b, a));
        total += 1;
      }
      if (APPLY && Object.keys(data).length) {
        await prisma.product.update({ where: { id: row.id }, data });
      }
    }

    const categories = await prisma.category.findMany({
      select: { id: true, slug: true, description: true, metaDescription: true },
    });
    for (const row of categories) {
      const data: Record<string, Prisma.InputJsonValue> = {};
      for (const field of CATEGORY_FIELDS) {
        const before = row[field];
        const after = fixTranslatableSpacing(before);
        if (after === before) continue;
        data[field] = after as Prisma.InputJsonValue;
        const b = (before as Record<string, string>)?.en ?? '';
        const a = (after as Record<string, string>)?.en ?? '';
        console.log(`Category ${row.slug} . ${field}`);
        console.log(excerpt(b, a));
        total += 1;
      }
      if (APPLY && Object.keys(data).length) {
        await prisma.category.update({ where: { id: row.id }, data });
      }
    }

    console.log('');
    console.log(`scanned ${products.length} product(s) and ${categories.length} categor(y/ies)`);
  } finally {
    await prisma.$disconnect();
  }
  return total;
}

async function main(): Promise<void> {
  console.log(`mode: ${APPLY ? 'APPLY (writes)' : 'dry-run (no writes)'}`);
  console.log('');

  const total = CATALOGUES ? patchCatalogues() : await patchDatabase();

  console.log('');
  console.log(`${total} field(s) ${APPLY ? 'changed' : 'pending'}`);
  if (APPLY && total > 0 && !CATALOGUES) {
    console.log(
      'flush the Redis for this stack: product and category payloads are cached, so the ' +
        'storefront would keep serving the joined text.',
    );
  }
  if (!APPLY && total > 0) {
    console.log('re-run with --apply once the changes above look right.');
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
