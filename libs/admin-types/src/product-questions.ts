import * as z from 'zod';
import { translatableSchema, translatableNullableSchema } from './translatable';

/**
 * ProductQuestion entity shape — admin-side response for
 * `GET /v1/admin/questions/:id` and `GET /v1/admin/questions` after the E5
 * Translatable migration. The Translatable migration replaces the pre-E5
 * plain-string `question` and `answer` with the canonical
 * `{ default, fr, en }` JSONB shape (§02 + spec §9.7 Q&A).
 *
 * Living in `libs/admin-types/` per constitution §3.14 + DR-21.
 *
 * Mirrors the Prisma model at `prisma/schema.prisma:1038-1060` (`ProductQuestion`
 * model) post-migration: `question Json` + `answer Json?` (Translatable), plus
 * the unchanged `questionLocale` provenance column.
 */

export const QUESTION_STATUSES = ['PENDING', 'PUBLISHED', 'HIDDEN'] as const;
export const questionStatusSchema = z.enum(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

export const productQuestionSchema = z.object({
  id: z.string(),
  productId: z.string(),
  question: translatableSchema,
  /** Submission locale captured at create time; null when no Accept-Language header. */
  questionLocale: z.string().nullable(),
  /** userId of the asker; null for anonymous questions. */
  askedById: z.string().nullable(),
  answer: translatableNullableSchema,
  /** userId of the staff / customer who answered; null when unanswered. */
  answeredBy: z.string().nullable(),
  isAdminAnswer: z.boolean(),
  helpfulCount: z.number().int().min(0),
  status: questionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProductQuestion = z.infer<typeof productQuestionSchema>;
