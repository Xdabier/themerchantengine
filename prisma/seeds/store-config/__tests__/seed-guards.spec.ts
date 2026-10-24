import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Static guards over `prisma/seed.ts`.
 *
 * Each rule pins a state a remediation plan once had to clean out of a
 * database by hand, so that a fresh `prisma db seed` cannot plant it again.
 *
 * These are SOURCE assertions on purpose. Most demo rows are planted with
 * `upsert ... update: {}`, so a behavioural test against a seeded database
 * would pass on an already-drifted row and prove nothing. Reading the literals
 * is what actually catches a reseed re-planting the state.
 *
 * Every rule below asserts the POSITIVE form it wants, not merely the absence
 * of the old one, so a rename cannot make a rule quietly stop testing anything.
 */

const SEED_PATH = path.resolve(__dirname, '..', '..', '..', 'seed.ts');
const source = fs.readFileSync(SEED_PATH, 'utf8');

/** Returns the source of the `prisma.<model>.upsert({...})` call carrying `id: '<id>'`. */
function upsertBlockById(id: string): string {
  const anchor = source.indexOf(`id: '${id}'`);
  expect(anchor, `no seed block carries id '${id}'`).toBeGreaterThan(-1);
  // Walk back to the enclosing upsert call, then forward to its closing `});`.
  const start = source.lastIndexOf('.upsert(', anchor);
  expect(start, `id '${id}' is not inside an upsert call`).toBeGreaterThan(-1);
  const end = source.indexOf('\n  });', anchor);
  expect(end, `the upsert carrying id '${id}' never closes`).toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe('prisma/seed.ts guards', () => {
  describe('the seed reads the runtime store config (DR-31, plan E1.4)', () => {
    it('resolves one config at the top of main and hands it to the three config seeds', () => {
      expect(source).toMatch(/const storeConfig: StoreRuntimeConfig =/);
      expect(source).toMatch(/storeConfigFromSettingRows\(/);
      expect(source).toMatch(/seedTax\(prisma, storeConfig\)/);
      expect(source).toMatch(
        /seedShipping\(prisma, storeConfig, \{ flatRate: seedFlatRate\(\) \}\)/,
      );
      expect(source).toMatch(/seedPaymentMethods\(prisma\)/);
    });

    it('writes the stepper config file into the rows before any template is seeded (plan E4.4)', () => {
      // The notification templates are seeded with the locale set the database
      // holds at seed time, so the config rows have to land first, on both
      // paths. Positive form: the write exists, and it precedes every template
      // seed call.
      const configWrite = source.indexOf('await seedStoreConfig(prisma, fileConfig)');
      expect(configWrite).toBeGreaterThan(-1);
      const templateCalls = [...source.matchAll(/await seedNotificationTemplates\(/g)].map(
        (m) => m.index ?? -1,
      );
      expect(templateCalls.length).toBeGreaterThanOrEqual(2);
      for (const at of templateCalls) expect(at).toBeGreaterThan(configWrite);
      expect(source).toMatch(/storeConfigFromEnv\(\)/);
    });

    it('writes every order and gift-card currency from the config, never a literal', () => {
      const literal = /currency:\s*'[A-Z]{3}'/;
      expect(source).not.toMatch(literal);
      const fromConfig = source.match(/currency:\s*storeConfig\.money\.currencyCode/g) ?? [];
      // Four orders plus the gift card.
      expect(fromConfig.length).toBeGreaterThanOrEqual(5);
    });

    it('formats every advertised amount with formatMoney rather than a currency suffix', () => {
      expect(source).toMatch(/formatMoney\(300, storeConfig\.money\)/);
      // No "300 ABC" style amount with an ISO code baked into the copy.
      expect(source).not.toMatch(/\b\d+\s?[A-Z]{3}\b/);
    });

    it('plants no demo shipping zone; the config seed owns shipping', () => {
      expect(source).not.toMatch(/prisma\.shippingZone\.upsert/);
      expect(source).not.toMatch(/prisma\.shippingMethod\.upsert/);
    });

    it('writes only registered settings keys in the general group', () => {
      // `general.currency`, `general.currencySymbol`, `general.storeEmail` and
      // `general.storePhone` were never in SETTINGS_KEYS, so no reader saw
      // them; the money and contact values live in the config rows now.
      const generalKeys = [...source.matchAll(/group:\s*'general',\s*key:\s*'([^']+)'/g)].map(
        (m) => m[1],
      );
      expect(generalKeys).toEqual(['storeName']);
    });
  });

  describe('S6: the demo home sections cannot come back', () => {
    it('plants no storefront section on the home page', () => {
      // The five demo rows (section-hero, section-promo, section-featured,
      // section-categories, section-trust) were the only home-page sections in
      // this file. A store's real sections come from its own catalogue seed.
      expect(source).not.toMatch(/pageSlug:\s*'home'/);
    });
  });

  describe('T6: the seeded gift card must satisfy the code contract', () => {
    it('seeds a code of 8 to 20 uppercase alphanumerics, which ApplyGiftCardDto accepts', () => {
      const block = source.slice(source.indexOf('prisma.giftCard.upsert'));
      const code = /code:\s*'([^']+)'/.exec(block)?.[1];

      expect(code, 'the gift card upsert has no code literal').toBeDefined();
      // Same contract as apply-gift-card.dto.ts and the storefront validator.
      // The old 'GIFT-TEST-1234' failed it at every layer, so the card could
      // never be applied anywhere.
      expect(code).toMatch(/^[A-Z0-9]{8,20}$/);
    });

    it('keeps the cleanup exclusions on the same code it creates', () => {
      const block = source.slice(source.indexOf('prisma.giftCard.upsert'));
      const code = /code:\s*'([^']+)'/.exec(block)?.[1] as string;

      // Two deleteMany calls spare the seeded card by literal. If they drift
      // from the created code, the seed deletes the card it just made.
      const exclusions = source.match(/code:\s*\{\s*not:\s*'([^']+)'\s*\}/g) ?? [];
      expect(exclusions.length).toBeGreaterThanOrEqual(2);
      for (const exclusion of exclusions) expect(exclusion).toContain(code);
    });
  });

  describe('T3 and D4: the demo promotions must not be live', () => {
    for (const id of ['promo-buy2', 'promo-freeship']) {
      it(`seeds ${id} inactive`, () => {
        // promo-buy2 is a BUY_X_GET_Y whose engine contract gives the Y item
        // free while its name once promised 10 percent off, so a live row is a
        // money leak. promo-freeship advertises a threshold no operator configured.
        expect(upsertBlockById(id)).toMatch(/isActive:\s*false/);
      });
    }
  });

  describe('AD13: seeded order numbers must match the generator format', () => {
    it('draws every seeded order number from the shared helper', () => {
      // generateOrderNumber pads to 6 (orders.service.ts). Literal four-digit
      // numbers put two formats side by side in the same admin list.
      expect(source).not.toMatch(/orderNumber:\s*'/);
      const helperCalls = source.match(/orderNumber:\s*seedOrderNumber\(\d+\)/g) ?? [];
      expect(helperCalls.length).toBeGreaterThan(0);
    });

    it('reserves the seeded numbers in the sequence the generator draws from', () => {
      // Sharing the generator's format means sharing its namespace. Without a
      // setval the first order placed on a freshly seeded database is handed
      // ORD-<year>-000001 again and dies on the unique index, which is a 409 on
      // POST /v1/orders. The SequenceCounter rows do not prevent this: the
      // generator never reads them.
      expect(source).toMatch(/order_seq_\$\{currentYear\}/);
      expect(source).toMatch(/setval\(/);
      expect(source).toMatch(/GREATEST\(/);
    });
  });

  describe('K-D6: the destructive demo seed runs unasked on the test database only', () => {
    it('is an allow-list of database names, with SEED_DEV_OK=1 as the only override', () => {
      // A bare `prisma db seed` hard-deletes every non-seeded order, review,
      // user and gift card. On dev that is the QA repro artifacts; on a store
      // the install stepper created (`merchants_engine`) it is the store. The
      // guard used to refuse one name, `merchants_engine_dev`, and let every
      // other through; it names the databases it allows now.
      expect(source).toMatch(/const DEMO_SEED_DATABASES = \['merchants_engine_test'\];/);
      expect(source).toMatch(
        /if \(!DEMO_SEED_DATABASES\.includes\(seedDatabaseName\) && process\.env\.SEED_DEV_OK !== '1'\)/,
      );
      expect(source).not.toMatch(/seedDatabaseName === 'merchants_engine_dev'/);
    });

    it('places the tripwire after the prod-safe SEED_SCOPE early return', () => {
      // CI runs the prod seed with SEED_SCOPE=notifications-rbac and must never
      // meet the guard.
      const scopeReturn = source.indexOf("process.env.SEED_SCOPE === 'notifications-rbac'");
      const tripwire = source.indexOf("process.env.SEED_DEV_OK !== '1'");

      expect(scopeReturn).toBeGreaterThan(-1);
      expect(tripwire).toBeGreaterThan(scopeReturn);
    });
  });
});
