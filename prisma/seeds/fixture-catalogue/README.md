# Fixture catalogue seed

Incremental seed for the storefront-fixture catalogue feature. Runs after the baseline
seed (`prisma/seed.ts`) and populates a realistic catalog scoped to the
`fx-` slug prefix so it can be re-run without disturbing baseline data.

## Usage

```bash
# Dev DB (localhost:55432)
npm run db:seed:fixture-catalogue

# Test DB (localhost:55433) — also wired as Playwright globalSetup
ts-node scripts/seed-storefront-test.ts
```

## Idempotence

The seed clears catalogue-scoped rows before re-creating them. Scope keys:

| Entity     | Marker                                          |
|------------|-------------------------------------------------|
| Category   | `slug LIKE 'fx-%'`                              |
| Product    | `slug LIKE 'fx-%'`                              |
| Promotion  | `couponCode IN ('FIXTURE10','WELCOME50')` + auto promo via `PromotionCategory` join |
| GiftCard   | `code LIKE 'FXGIFT%'`                           |
| User       | `email LIKE '%@fixture.test'`                 |
| Asset      | `alt->>'fixtureSeed' = true`                  |
| Inventory  | `code = 'FIXTURE-MAIN-WH'`                    |

## Append-only carve-out (constitution §3.4)

These tables are **never written** by the seed:

- `Order`, `OrderItem`
- `InventoryMovement`
- `GiftCardTransaction`
- `PromotionUsage`
- `AuditLogEntry`

Seed shapes inventory by writing `StockLevel` directly (the materialised
cache), not by fabricating movement history. Promotion usage is left for the
storefront e2e to generate organically through the checkout flow in S10.

## Output

~36 products across 5 categories. Each product carries:

- bilingual `Translatable` name / description / metadata
- 3 product images (hero + 2 gallery) processed via the same
  sharp + blurhash pipeline the production
  `apps/api/src/modules/assets/processors/image-processing.processor.ts` uses
- a single default `ProductVariant` priced in the store currency
- 3-15 reviews + 0-5 Q&A entries
- Inventory state across in-stock / low-stock / out-of-stock bands

Plus:

- 3 promotions (2 coupons + 1 auto-applied Electronics 10% off)
- 1 store-issued gift card (`FXGIFTWELCOME100` — 16-char alphanumeric matching `ApplyGiftCardDto`)
- 1 dev customer (`cod-test+fixture@fixture.test`) with address + wishlist
