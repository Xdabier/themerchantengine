/**
 * Dev-scoped cleanup of the rows the storefront renders but nobody chose.
 *
 * Authority: `specs/features/storefront-qa-remediation/plan-k-storefront-data-hygiene.md`
 *
 * Three scopes, one per flag, deliberately separate because they answer to
 * different owners and land at different times:
 *
 *   (no flag)     Phase K2, the DEMO-SEED rows: S6, C6, C7, C5, X1 demo half,
 *                 T3 and D4 data halves, D7 data row.
 *   --artifacts   Phase K5, the section-X QA repro rows, one line at a time as
 *                 each owning plan lands.
 *
 * OWNERSHIP SPLIT (plan K decision K-D1). This script touches DEMO-SEED rows
 * only. Every `E2E *` row belongs to
 * `specs/features/admin-qa-remediation/plan-h-test-data-hygiene.md` and its own
 * script; the two must never race over the same row. The fixture catalogue's
 * own rows (`fx-*` products, its promotions, its home sections) belong to its
 * seeder, which deletes and recreates them on every full run; this file only
 * HIDES the `fx-` categories, per K-D5, because hiding is what clears the
 * duplicate sidebar names and is reversible.
 *
 * The client-migration mode this script used to carry left with plan E2: there
 * is no previous client's rows to retire in a brandless engine.
 *
 * WHY SOFT-DELETE AND NOT HARD-DELETE. The demo blocks stay in `prisma/seed.ts`
 * because the three test databases need them (backend e2e depends on
 * `WELCOME10`, admin journeys on `prod-backpack`). The demo rows are planted
 * with `upsert ... update: {}`, and the seed client carries no soft-delete
 * middleware, so the upsert FINDS a soft-deleted row and changes nothing.
 * Soft-delete therefore survives a reseed; a hard delete would be undone by the
 * next one. Demo order items reference the demo products, so soft-delete also
 * keeps the FK story intact.
 *
 * WHY RAW `pg` AND NOT PRISMA. `PrismaService` installs the soft-delete
 * middleware, which would hide the very rows this script has to report on and
 * re-run against. The driver is the same one `prisma/apply-fts-setup.ts` uses.
 *
 * AFTER `--apply` you MUST flush the dev Redis, or the storefront keeps serving
 * the pre-cleanup sections and categories from cache:
 *
 *   docker exec merchants-engine-redis-dev redis-cli FLUSHDB
 *
 * Protocol (plan H precedent, plan K §7): dry-run, review every printed row
 * against the plan's measurements, `--apply`, re-run the dry-run to prove zero
 * remaining, paste the counts into the commit body.
 *
 *   npx ts-node scripts/cleanup-demo-storefront.ts
 *   npx ts-node scripts/cleanup-demo-storefront.ts --apply
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');

/**
 * `--artifacts` is the Phase K5 sweep: the QA repro rows of
 * `docs/storefront-manual-qa-findings.md` section X, retired one line at a time
 * as their owning plan lands. Only lines whose owner is DONE live here; the
 * rest stay in the KEEP list until then. Two are already closed: the orders are
 * append-only and are never deleted, and the gift card is patched by the
 * fixture catalogue seed.
 */
const ARTIFACTS_MODE = process.argv.includes('--artifacts');

// ── Safety guard ─────────────────────────────────────────────────────────────

/**
 * Fail-closed, no override flag (plan H decision D8 style, copied rather than
 * shared because plan H has not landed its patterns module yet). Both the host
 * and the database name must match: a tunnelled prod connection can carry a
 * localhost host, and a dev-named database can live on a remote host.
 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const ALLOWED_DATABASES = new Set(['merchants_engine_dev', 'merchants_engine_test']);

function assertDevDatabase(databaseUrl: string | undefined): URL {
  if (!databaseUrl) throw new Error('[cleanup] DATABASE_URL is not set');
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, '');
  if (!ALLOWED_HOSTS.has(url.hostname) || !ALLOWED_DATABASES.has(database)) {
    // Never print the URL itself: it carries the password (constitution §3.7).
    throw new Error(
      `[cleanup] refusing to run against host "${url.hostname}" database "${database}". ` +
        `Allowed: ${[...ALLOWED_HOSTS].join(', ')} and ${[...ALLOWED_DATABASES].join(', ')}.`,
    );
  }
  return url;
}

// ── The demo scope ───────────────────────────────────────────────────────────

/** `prisma/seed.ts` plants these five with fixed ids and `pageSlug='home'`. */
const DEMO_SECTION_IDS = [
  'section-hero',
  'section-promo',
  'section-featured',
  'section-categories',
  'section-trust',
];

/** Matched by id, never by slug pattern: a slug pattern could reach real rows. */
const DEMO_PRODUCT_IDS = [
  'prod-iphone',
  'prod-samsung',
  'prod-headphones',
  'prod-tshirt',
  'prod-polo',
  'prod-jeans',
  'prod-shoes',
  'prod-wallet',
  'prod-bottle',
  'prod-backpack',
];

const DEMO_CATEGORY_SLUGS = ['electronics', 'phones', 'fashion', 'men', 'shoes'];

/**
 * The fixture catalogue's category tree. Hidden, not deleted (K-D5): its
 * products carry live QA repro artifacts for plan G, and `seedFixtureCatalogue`
 * deletes and recreates the whole tree on every full run, so a merge would
 * fight the seeder.
 */
const FIXTURE_CATEGORY_SLUGS = [
  'fx-electronics',
  'fx-audio',
  'fx-wearables',
  'fx-home-essentials',
  'fx-personal-care',
  'fx-pro-headphones',
  'fx-wireless-headphones',
  'fx-smart-watches',
  'fx-fitness-trackers',
  'fx-smart-home',
  'fx-hydration',
];

/**
 * Demo promotions that reach a customer's money.
 *
 * `promo-buy2` is named "Buy 2, Get 10% Off" but is a `BUY_X_GET_Y` promotion,
 * whose adjudicated engine contract gives the Y item FREE (admin plan A finding
 * A7). Its `value: 10` is dormant, so the name understates what it takes: a
 * live money leak on any two-unit line (pass-2 finding T3). `promo-freeship`
 * advertises a free-shipping threshold the operator never configured (D4).
 * Plan A owns the money math and the copy; this script only stops the dev
 * storefront from applying them.
 */
const DEMO_PROMOTION_IDS = ['promo-buy2', 'promo-freeship'];

// ── Step definitions ─────────────────────────────────────────────────────────

interface Step {
  title: string;
  finding: string;
  /** Rows this step would change. Empty result means the step is already done. */
  select: { text: string; values: unknown[] };
  apply: { text: string; values: unknown[] };
}

const STEPS: Step[] = [
  {
    title: 'StorefrontSection: soft-delete the demo home sections',
    finding: 'S6',
    select: {
      text: `SELECT id, "sortOrder", type, title->>'default' AS title
               FROM "StorefrontSection"
              WHERE id = ANY($1) AND "deletedAt" IS NULL
              ORDER BY "sortOrder"`,
      values: [DEMO_SECTION_IDS],
    },
    apply: {
      text: `UPDATE "StorefrontSection"
                SET "deletedAt" = now(), "isVisible" = false
              WHERE id = ANY($1) AND "deletedAt" IS NULL`,
      values: [DEMO_SECTION_IDS],
    },
  },
  {
    title: 'Product: soft-delete the ten demo products',
    finding: 'C7 data half, X2',
    select: {
      text: `SELECT id, slug, name->>'default' AS name, status
               FROM "Product"
              WHERE id = ANY($1) AND "deletedAt" IS NULL
              ORDER BY id`,
      values: [DEMO_PRODUCT_IDS],
    },
    apply: {
      text: `UPDATE "Product" SET "deletedAt" = now()
              WHERE id = ANY($1) AND "deletedAt" IS NULL`,
      values: [DEMO_PRODUCT_IDS],
    },
  },
  {
    // Products first, so no live product is left pointing at a dead category.
    title: 'Category: soft-delete the five demo categories',
    finding: 'C6 demo family, C5',
    select: {
      text: `SELECT id, slug, name->>'default' AS name, "isVisible"
               FROM "Category"
              WHERE slug = ANY($1) AND "deletedAt" IS NULL
              ORDER BY slug`,
      values: [DEMO_CATEGORY_SLUGS],
    },
    apply: {
      text: `UPDATE "Category"
                SET "deletedAt" = now(), "isVisible" = false
              WHERE slug = ANY($1) AND "deletedAt" IS NULL`,
      values: [DEMO_CATEGORY_SLUGS],
    },
  },
  {
    title: 'Category: hide the fixture-catalogue onefire tree (products stay reachable)',
    finding: 'C6 rest, C5',
    select: {
      text: `SELECT id, slug, name->>'default' AS name, "isVisible"
               FROM "Category"
              WHERE slug = ANY($1) AND "deletedAt" IS NULL AND "isVisible" = true
              ORDER BY slug`,
      values: [FIXTURE_CATEGORY_SLUGS],
    },
    apply: {
      text: `UPDATE "Category" SET "isVisible" = false
              WHERE slug = ANY($1) AND "deletedAt" IS NULL AND "isVisible" = true`,
      values: [FIXTURE_CATEGORY_SLUGS],
    },
  },
  {
    title: 'Promotion: deactivate and soft-delete the two demo promotions',
    finding: 'T3 and D4 data halves',
    select: {
      text: `SELECT id, name->>'default' AS name, type, "isActive"
               FROM "Promotion"
              WHERE id = ANY($1) AND "deletedAt" IS NULL
              ORDER BY id`,
      values: [DEMO_PROMOTION_IDS],
    },
    apply: {
      text: `UPDATE "Promotion"
                SET "deletedAt" = now(), "isActive" = false
              WHERE id = ANY($1) AND "deletedAt" IS NULL`,
      values: [DEMO_PROMOTION_IDS],
    },
  },
];

/**
 * Printed at the end so the operator sees what deliberately survived. These are
 * the QA repro artifacts of `docs/storefront-manual-qa-findings.md` §X; plan K
 * Phase K5 retires each one only after its owning plan has landed.
 */
const KEEP_LIST: { row: string; owner: string }[] = [
  {
    row: 'GiftCard GIFTTEST12345678 (the seeded card)',
    owner: 'plan A, finding T6',
  },
  {
    row: 'Order ORD-2026-000002 and its invoice',
    owner: 'plans A and F, append-only, never deleted',
  },
  { row: 'Review and question on fx-laptop-office-15-workstation', owner: 'plan G' },
  { row: 'CMS page /qa-page-2026', owner: 'plan C' },
  { row: 'CMS page /about raw-HTML body', owner: 'plan D, operator content decision' },
  {
    row: 'Subscriber qa-newsletter*@example.com',
    owner: 'nobody, deleted by --artifacts',
  },
  {
    row: 'Product fx-laptop-office-15-workstation and the categories it sits in',
    owner: 'plan G, the only catalogue rows the sweep spares',
  },
  { row: 'Every E2E * row in any table', owner: 'admin plan H, never this script' },
  {
    row: 'the configured VAT zone and taxzone-default (0%)',
    owner: 'the store tax design, see the note below',
  },
];

/**
 * The plan-G repro. Its review and admin-answered question hang off this
 * product, so it stays live and reachable by direct URL while every other
 * fixture-catalogue product goes. Its categories are spared for the same reason: a
 * soft-deleted category would take the product breadcrumb with it.
 */
// That product's slug is fx-laptop-office-15-workstation; the steps below name it by id.

const ARTIFACT_STEPS: Step[] = [
  {
    // The only section-X row with no owning plan: the newsletter path it was
    // minted to prove was verified during the QA pass itself, and nothing
    // references the address. Hard delete, because Subscriber carries no
    // soft-delete column and the row is not evidence of anything.
    title: 'Subscriber: delete the QA newsletter probe',
    finding: 'section X',
    select: {
      text: `SELECT id, email, "createdAt"
               FROM "Subscriber"
              WHERE email LIKE 'qa-newsletter%@example.com'
              ORDER BY email`,
      values: [],
    },
    apply: {
      text: `DELETE FROM "Subscriber" WHERE email LIKE 'qa-newsletter%@example.com'`,
      values: [],
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url = assertDevDatabase(process.env.DATABASE_URL);
  const database = url.pathname.replace(/^\//, '');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const steps = ARTIFACTS_MODE ? ARTIFACT_STEPS : STEPS;
  const scope = ARTIFACTS_MODE ? 'QA ARTIFACTS (Phase K5)' : 'DEMO SEED (Phase K2)';

  console.log(`\n[cleanup] database ${database} on ${url.hostname}:${url.port}`);
  console.log(`[cleanup] scope ${scope}`);
  console.log(`[cleanup] mode ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  let pending = 0;
  try {
    for (const step of steps) {
      const found = await client.query(step.select.text, step.select.values);
      console.log(`── ${step.title}  [${step.finding}]`);
      if (found.rowCount === 0) {
        console.log('   0 rows, nothing to do\n');
        continue;
      }
      pending += found.rowCount ?? 0;
      for (const row of found.rows) {
        console.log(
          `   ${Object.entries(row)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join('  ')}`,
        );
      }
      if (APPLY) {
        const changed = await client.query(step.apply.text, step.apply.values);
        console.log(`   applied: ${changed.rowCount} row(s) changed\n`);
      } else {
        console.log(`   would change ${found.rowCount} row(s)\n`);
      }
    }

    console.log('── KEPT ON PURPOSE (plan K Phase K5 retires these, each after its owning plan)');
    for (const keep of KEEP_LIST) console.log(`   ${keep.row}  ->  ${keep.owner}`);
    console.log(
      '\n   Tax note: plan K K-D2 recommended zero-rating both seeded zones. That\n' +
        '   decision was authored against a dev database where 35 leaked "E2E Zone"\n' +
        '   rows at 5 percent were taxing a store whose market levies no VAT. A store\n' +
        '   that does levy one has a real rate seeded from its runtime config (DR-31),\n' +
        '   and zero-rating that would break its tax design, so this script leaves\n' +
        '   tax alone.',
    );

    if (!APPLY) {
      console.log(
        `\n[cleanup] DRY RUN complete. ${pending} row(s) pending. Re-run with --apply to write.`,
      );
    } else {
      console.log('\n[cleanup] APPLY complete.');
      console.log(
        '[cleanup] NOW FLUSH THE DEV REDIS, or the storefront serves the pre-cleanup state:',
      );
      console.log('[cleanup]   docker exec merchants-engine-redis-dev redis-cli FLUSHDB');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[cleanup] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
