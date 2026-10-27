import * as z from 'zod';
import { translatableSchema, translatableNullableSchema } from './translatable';

/**
 * Review entity shape — the admin-side response for `GET /v1/admin/reviews/:id`
 * after the E5 Translatable migration. The Translatable migration replaces the
 * pre-E5 plain-string `title` and `body` with the canonical
 * `{ default, fr, en }` JSONB shape (§02 + DR-N/A).
 *
 * Living in `libs/admin-types/` per constitution §3.14 + DR-21 (the entity-level
 * Zod schemas land here; the 31 pre-existing module schemas at
 * `libs/admin-services/src/<module>/<module>.schemas.ts` stay put per DR-21).
 *
 * The schema mirrors the Prisma model at `prisma/schema.prisma:997-1022`
 * (`Review` model) post-migration: `title Json?` + `body Json` (Translatable),
 * plus the unchanged `locale` provenance column.
 */

export const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'HIDDEN'] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  productId: z.string(),
  userId: z.string(),
  title: translatableNullableSchema,
  body: translatableSchema,
  /** Submission locale captured at create time; null when no Accept-Language header. */
  locale: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  verifiedPurchase: z.boolean(),
  helpfulCount: z.number().int().min(0),
  status: reviewStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Review = z.infer<typeof reviewSchema>;
