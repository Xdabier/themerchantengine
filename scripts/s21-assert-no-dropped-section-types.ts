/**
 * S21 cutover deploy script — DR-04 / DR-05 enum trim + StoreSetting cleanup.
 *
 * The merchants-engine repo uses `prisma db push` (no migration history — see
 * root CLAUDE.md line 35 and clarifications.md §1.34). This script is the deploy
 * runbook entry point for the S21 schema cutover. Run order:
 *
 *   1. Operator runs:  npx ts-node scripts/s21-assert-no-dropped-section-types.ts
 *      → Asserts zero StorefrontSection rows of dropped types
 *      → Asserts no source-code references to home.{hero,midBanner}.* keys
 *      → Deletes the four StoreSetting cleanup rows (idempotent)
 *      Exits non-zero if any pre-flight check fails (no destructive op runs).
 *
 *   2. Operator runs:  npm run db:push
 *      → Applies the prisma/schema.prisma SectionType enum subset edit
 *        (removes TESTIMONIALS, NEWSLETTER_SIGNUP, RICH_CONTENT,
 *        RECOMMENDATIONS, ANNOUNCEMENT_BAR — leaves HERO,
 *        FEATURED_PRODUCTS, CATEGORY_SHOWCASE, PROMOTIONAL_BANNER,
 *        TRUST_SIGNALS).
 *
 *   3. Operator restarts API workers (rolling) and deploys the new
 *      storefront image with STOREFRONT_DYNAMIC_SECTIONS=1 baked at build time.
 *
 * Rollback: the dropped enum values can be re-added in prisma/schema.prisma
 * and re-applied via `npm run db:push`; existing rows are unaffected because
 * the script asserts zero rows of dropped types before the schema edit lands.
 * The deleted StoreSetting rows can be re-seeded by reverting the
 * banners.ts seed deletion in the same commit.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DROPPED_SECTION_TYPES = [
  'TESTIMONIALS',
  'NEWSLETTER_SIGNUP',
  'RICH_CONTENT',
  'RECOMMENDATIONS',
  'ANNOUNCEMENT_BAR',
] as const;

const DROPPED_STORE_SETTING_KEYS = [
  'home.hero.imageUrl',
  'home.hero.altText',
  'home.midBanner.imageUrl',
  'home.midBanner.altText',
] as const;

const APPLY = process.argv.includes('--apply');
const REPO_ROOT = path.resolve(__dirname, '..');

interface AssertionResult {
  label: string;
  passed: boolean;
  detail: string;
}

async function assertNoDroppedTypeRows(prisma: PrismaClient): Promise<AssertionResult> {
  // Raw query because the regenerated Prisma client (post `prisma generate`
  // against the trimmed schema) no longer recognizes the dropped enum values
  // in its typed `where` filter. The query itself is fully parameterized via
  // `Prisma.join` — no concatenated user input.
  const rows = await prisma.$queryRaw<{ type: string; count: bigint }[]>(
    Prisma.sql`SELECT type::text AS type, COUNT(*)::bigint AS count
       FROM "StorefrontSection"
       WHERE type::text IN (${Prisma.join([...DROPPED_SECTION_TYPES])})
       GROUP BY type`,
  );
  if (rows.length === 0) {
    return {
      label: 'StorefrontSection rows of dropped types',
      passed: true,
      detail: '0 rows across 5 dropped types',
    };
  }
  const summary = rows.map((r) => `${r.type}=${r.count.toString()}`).join(', ');
  return {
    label: 'StorefrontSection rows of dropped types',
    passed: false,
    detail: `nonzero rows present: ${summary}`,
  };
}

function findFilesRecursively(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.angular') {
          continue;
        }
        stack.push(full);
      } else if (entry.isFile() && predicate(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

function assertNoSourceReferences(): AssertionResult {
  // Scope: storefront app + admin app + storefront services. The legacy
  // `apps/api/src/modules/storefront-config/storefront-config.service.ts`
  // `getHomeBanners()` method intentionally keeps the StoreSetting key
  // references — the endpoint stays alive for one release window per plan
  // §S21.3, deprecated and warning-logged but still operational. After the
  // StoreSetting rows are deleted (this same script's --apply mode) the
  // endpoint returns null banners until a follow-up commit removes it.
  const SCAN_ROOTS = [
    path.join(REPO_ROOT, 'apps', 'storefront', 'src'),
    path.join(REPO_ROOT, 'apps', 'admin', 'src'),
    path.join(REPO_ROOT, 'libs', 'storefront-services', 'src'),
  ];
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const files = findFilesRecursively(root, (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const key of DROPPED_STORE_SETTING_KEYS) {
        if (content.includes(key)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} → references "${key}"`);
        }
      }
    }
  }
  if (offenders.length === 0) {
    return {
      label: 'No source references to home.{hero,midBanner}.* keys',
      passed: true,
      detail:
        'apps/storefront, apps/admin, libs/storefront-services scanned (apps/api carve-out: deprecated endpoint kept for one release)',
    };
  }
  return {
    label: 'No source references to home.{hero,midBanner}.* keys',
    passed: false,
    detail: offenders.join('\n          '),
  };
}

async function deleteStoreSettingRows(prisma: PrismaClient): Promise<number> {
  if (!APPLY) {
    const rows = await prisma.storeSetting.findMany({
      where: {
        group: 'storefront',
        key: { in: DROPPED_STORE_SETTING_KEYS as unknown as string[] },
      },
    });
    return rows.length;
  }
  const result = await prisma.storeSetting.deleteMany({
    where: { group: 'storefront', key: { in: DROPPED_STORE_SETTING_KEYS as unknown as string[] } },
  });
  return result.count;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (set in .env or process env).');
    process.exit(1);
  }
  const adapter = new PrismaPg(databaseUrl);
  const prisma = new PrismaClient({ adapter });
  let exitCode = 0;
  try {
    console.log('S21 cutover script — pre-flight assertions');
    console.log(
      APPLY
        ? '  mode: APPLY (will delete StoreSetting rows)'
        : '  mode: DRY-RUN (pass --apply to mutate)',
    );
    console.log('');

    const results: AssertionResult[] = [];
    results.push(await assertNoDroppedTypeRows(prisma));
    results.push(assertNoSourceReferences());

    for (const r of results) {
      const tag = r.passed ? 'PASS' : 'FAIL';
      console.log(`  [${tag}] ${r.label}`);
      console.log(`         ${r.detail}`);
    }
    console.log('');

    const allPassed = results.every((r) => r.passed);
    if (!allPassed) {
      console.error('Pre-flight assertions failed — aborting before any destructive op.');
      exitCode = 1;
      return;
    }

    const settingCount = await deleteStoreSettingRows(prisma);
    if (APPLY) {
      console.log(
        `StoreSetting cleanup: deleted ${settingCount} rows under group=storefront, key IN (...)`,
      );
    } else {
      console.log(`StoreSetting cleanup: ${settingCount} rows would be deleted (dry-run)`);
    }
    console.log('');
    console.log('Pre-flight passed. Next: npm run db:push to apply schema enum subset edit.');
  } catch (err) {
    console.error('Script failed:', err);
    exitCode = 1;
  } finally {
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

void main();
