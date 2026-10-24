import { Inject, Injectable } from '@angular/core';
import {
  answerQuestionRequestSchema,
  apiResponseSchema,
  createQuestionRequestSchema,
  helpfulVoteResponseSchema,
  listQuestionsQuerySchema,
  paginationMetaSchema,
  questionSchema,
  type AnswerQuestionRequest,
  type CreateQuestionRequest,
  type ListQuestionsQuery,
  type PaginationMeta,
  type Question,
} from '@storefront-types';
import * as z from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

const paginatedQuestionsEnvelopeSchema = apiResponseSchema(z.array(questionSchema)).extend({
  meta: paginationMetaSchema,
});

@Injectable({ providedIn: 'root' })
export class QuestionsService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async list(
    productSlug: string,
    query: ListQuestionsQuery = {},
  ): Promise<{
    data: Question[];
    meta: PaginationMeta;
  }> {
    z.string().min(1).parse(productSlug);
    const parsed = listQuestionsQuerySchema.parse(query);
    const envelope = await this.api.get<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/questions`,
      { query: parsed as Record<string, number | undefined> },
    );
    const result = paginatedQuestionsEnvelopeSchema.parse(envelope);
    return { data: result.data, meta: result.meta };
  }

  async create(productSlug: string, input: CreateQuestionRequest): Promise<Question> {
    z.string().min(1).parse(productSlug);
    const body = createQuestionRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>(
      `/v1/products/${encodeURIComponent(productSlug)}/questions`,
      body,
    );
    return apiResponseSchema(questionSchema).parse(envelope).data;
  }

  /**
   * Post an answer and return the updated question.
   *
   * The endpoint returns the whole `ProductQuestion` row, which happens to
   * satisfy the old answer-record schema, so this used to duck-parse it as an
   * "answer" and hand the page something to append to a collection that does
   * not exist. Answers are a single column on the question; the caller
   * replaces the row.
   */
  async answer(questionId: string, input: AnswerQuestionRequest): Promise<Question> {
    z.string().min(1).parse(questionId);
    const body = answerQuestionRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>(
      `/v1/questions/${encodeURIComponent(questionId)}/answer`,
      body,
    );
    return apiResponseSchema(questionSchema).parse(envelope).data;
  }

  async toggleHelpful(questionId: string): Promise<z.infer<typeof helpfulVoteResponseSchema>> {
    z.string().min(1).parse(questionId);
    const envelope = await this.api.post<unknown>(
      `/v1/questions/${encodeURIComponent(questionId)}/helpful`,
    );
    return apiResponseSchema(helpfulVoteResponseSchema).parse(envelope).data;
  }
}
