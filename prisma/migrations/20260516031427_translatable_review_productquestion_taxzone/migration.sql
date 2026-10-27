-- ============================================================
-- E5 — Migrate Review.title, Review.body, ProductQuestion.question,
--      ProductQuestion.answer, and TaxZone.name from plain String to
--      Translatable JSONB.
--
-- Closes audit-plan §1.14 BLOCKERs 1, 2, and 3a (lines 225-227).
-- TaxClass.name (BLOCKER 3b) is intentionally kept as plain String per
-- DR-22 (specs/decision-records/22-tax-class-name-kept-as-string.md) —
-- the column is a functional type-tag (`isZeroRated()` predicate and
-- zone-level uniqueness key), not a display label.
--
-- Strategy: per affected column, ADD a new nullable JSONB tmp column →
-- backfill from the existing String column (wrapping into a Translatable
-- object with a `default` key plus the source locale key derived from the
-- adjacent `locale` / `questionLocale` column where present) → SET NOT NULL
-- on tmp columns whose source column was non-nullable → DROP the old
-- String column → RENAME tmp to the original name.
--
-- Lock posture: per-statement ALTER TABLE briefly takes ACCESS EXCLUSIVE.
-- The UPDATE statements run row-by-row with row-level locks. Production
-- row counts are low (Review thousands, ProductQuestion thousands,
-- TaxZone dozens), so the full migration completes in seconds. Prisma
-- migrate wraps the whole script in a single transaction; on any failure
-- the schema rolls back to its pre-migration state cleanly.
--
-- Rollback: a forward-revert migration regenerates the String columns
-- from `<column>->>'default'`:
--   ALTER TABLE "Review" ADD COLUMN "title_str" TEXT;
--   UPDATE "Review" SET "title_str" = "title"->>'default';
--   ALTER TABLE "Review" DROP COLUMN "title"; …etc.
--
-- Backfill locale resolution:
--   Review:          jsonb_build_object('default', body, COALESCE(locale, 'en'), body)
--   ProductQuestion: jsonb_build_object('default', question, COALESCE(questionLocale, 'en'), question)
--   TaxZone:         jsonb_build_object('default', name, 'en', name)   -- admin-authored; no per-row locale
--
-- Seed impact: prisma/seed.ts writes Review.title / Review.body /
-- ProductQuestion.question / ProductQuestion.answer / TaxZone.name as
-- plain strings today. After this migration, those write sites must
-- emit Translatable shape (`{ default: 'text', en: 'text', ar: '…' }`).
-- The seed updates land in the same commit per audit-plan §7.
-- ============================================================

-- ── Review.title (nullable String? → nullable Json?) ─────────────────────────
ALTER TABLE "Review" ADD COLUMN "title_tmp" JSONB;
UPDATE "Review"
  SET "title_tmp" = jsonb_build_object('default', "title", COALESCE("locale", 'en'), "title")
  WHERE "title" IS NOT NULL;
ALTER TABLE "Review" DROP COLUMN "title";
ALTER TABLE "Review" RENAME COLUMN "title_tmp" TO "title";

-- ── Review.body (non-nullable String → non-nullable Json) ────────────────────
ALTER TABLE "Review" ADD COLUMN "body_tmp" JSONB;
UPDATE "Review"
  SET "body_tmp" = jsonb_build_object('default', "body", COALESCE("locale", 'en'), "body");
ALTER TABLE "Review" ALTER COLUMN "body_tmp" SET NOT NULL;
ALTER TABLE "Review" DROP COLUMN "body";
ALTER TABLE "Review" RENAME COLUMN "body_tmp" TO "body";

-- ── ProductQuestion.question (non-nullable String → non-nullable Json) ───────
ALTER TABLE "ProductQuestion" ADD COLUMN "question_tmp" JSONB;
UPDATE "ProductQuestion"
  SET "question_tmp" = jsonb_build_object('default', "question", COALESCE("questionLocale", 'en'), "question");
ALTER TABLE "ProductQuestion" ALTER COLUMN "question_tmp" SET NOT NULL;
ALTER TABLE "ProductQuestion" DROP COLUMN "question";
ALTER TABLE "ProductQuestion" RENAME COLUMN "question_tmp" TO "question";

-- ── ProductQuestion.answer (nullable String? → nullable Json?) ───────────────
ALTER TABLE "ProductQuestion" ADD COLUMN "answer_tmp" JSONB;
UPDATE "ProductQuestion"
  SET "answer_tmp" = jsonb_build_object('default', "answer", COALESCE("questionLocale", 'en'), "answer")
  WHERE "answer" IS NOT NULL;
ALTER TABLE "ProductQuestion" DROP COLUMN "answer";
ALTER TABLE "ProductQuestion" RENAME COLUMN "answer_tmp" TO "answer";

-- ── TaxZone.name (non-nullable String → non-nullable Json) ───────────────────
ALTER TABLE "TaxZone" ADD COLUMN "name_tmp" JSONB;
UPDATE "TaxZone"
  SET "name_tmp" = jsonb_build_object('default', "name", 'en', "name");
ALTER TABLE "TaxZone" ALTER COLUMN "name_tmp" SET NOT NULL;
ALTER TABLE "TaxZone" DROP COLUMN "name";
ALTER TABLE "TaxZone" RENAME COLUMN "name_tmp" TO "name";

-- ── NOTE: TaxClass.name is intentionally NOT migrated per DR-22 ──────────────
-- See specs/decision-records/22-tax-class-name-kept-as-string.md.
