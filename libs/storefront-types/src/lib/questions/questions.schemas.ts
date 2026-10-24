import * as z from 'zod';
import { questionSchema } from '../shared/entities';

/**
 * Storefront questions schemas. Mirrors:
 * - `apps/api/src/modules/reviews/dto/create-question.dto.ts:CreateQuestionDto`
 * - `apps/api/src/modules/reviews/dto/answer-question.dto.ts:AnswerQuestionDto`
 * - `apps/api/src/modules/reviews/dto/query-reviews.dto.ts:ListQuestionsStorefrontDto`
 *
 * The split between `AnswerQuestionDto` (this file's `answerQuestionRequestSchema`)
 * and `AnswerQuestionAdminDto` was finalised at commit `ca231f0` to close the
 * R8.1 escalation — `isAdminAnswer` lives only on the admin DTO so storefront
 * callers cannot impersonate an admin answer.
 */

export const createQuestionRequestSchema = z.object({
  question: z.string().min(1).max(1000),
});
export type CreateQuestionRequest = z.infer<typeof createQuestionRequestSchema>;

export const answerQuestionRequestSchema = z.object({
  answer: z.string().min(1).max(5000),
});
export type AnswerQuestionRequest = z.infer<typeof answerQuestionRequestSchema>;

export const listQuestionsQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;

export { questionSchema };
export type { Question, QuestionStatus } from '../shared/entities';
