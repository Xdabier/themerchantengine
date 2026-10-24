import { describe, expect, it } from 'vitest';
import {
  answerQuestionRequestSchema,
  createQuestionRequestSchema,
  listQuestionsQuerySchema,
  questionSchema,
} from './questions.schemas';

describe('createQuestionRequestSchema', () => {
  it('accepts a non-empty question', () => {
    expect(() =>
      createQuestionRequestSchema.parse({ question: 'Is it waterproof?' }),
    ).not.toThrow();
  });

  it('rejects empty question', () => {
    expect(() => createQuestionRequestSchema.parse({ question: '' })).toThrow();
  });

  it('rejects > 1000 chars', () => {
    expect(() => createQuestionRequestSchema.parse({ question: 'a'.repeat(1001) })).toThrow();
  });
});

describe('answerQuestionRequestSchema', () => {
  it('accepts a valid answer', () => {
    expect(() => answerQuestionRequestSchema.parse({ answer: 'Yes, IPX5.' })).not.toThrow();
  });

  it('forbids extra admin-only fields', () => {
    // Strict parse drops unknown keys silently in zod default; ensure
    // `isAdminAnswer` is not part of the storefront input contract.
    const result = answerQuestionRequestSchema.parse({
      answer: 'Yes',
      isAdminAnswer: true,
    } as unknown as { answer: string });
    expect(Object.keys(result)).toEqual(['answer']);
  });

  it('rejects empty answer', () => {
    expect(() => answerQuestionRequestSchema.parse({ answer: '' })).toThrow();
  });

  it('rejects > 5000 chars', () => {
    expect(() => answerQuestionRequestSchema.parse({ answer: 'a'.repeat(5001) })).toThrow();
  });
});

describe('listQuestionsQuerySchema', () => {
  it('accepts pagination', () => {
    expect(() => listQuestionsQuerySchema.parse({ page: 1, pageSize: 25 })).not.toThrow();
  });
});

describe('questionSchema', () => {
  /**
   * The exact body `GET /v1/products/:slug/questions` returns, per
   * `QUESTION_PUBLIC_SELECT` in `apps/api/src/modules/reviews/reviews.service.ts`.
   * The schema used to model an `answers` array no endpoint has ever emitted,
   * so Zod supplied an empty one on every parse and the real answer rode
   * `.passthrough()` unread.
   */
  const wireQuestion = {
    id: 'q1',
    productId: 'p1',
    question: 'Existe-t-il une option de garantie étendue ?',
    questionLocale: 'fr',
    answer: 'Oui, une garantie étendue peut être ajoutée au moment du paiement.',
    isAdminAnswer: true,
    helpfulCount: 6,
    status: 'PUBLISHED',
    createdAt: '2026-08-26T21:11:12.379Z',
    updatedAt: '2026-08-26T21:11:12.379Z',
    asker: { firstName: 'Amel', lastName: 'Ben Salah' },
    product: { id: 'p1', slug: 'fx-laptop-office-15-workstation' },
  };

  it('parses the shape the questions endpoint actually returns', () => {
    const parsed = questionSchema.parse(wireQuestion);

    expect(parsed.answer).toBe(wireQuestion.answer);
    expect(parsed.isAdminAnswer).toBe(true);
    expect(parsed.questionLocale).toBe('fr');
    expect(parsed.asker?.firstName).toBe('Amel');
  });

  it('parses an unanswered question with a null asker', () => {
    const parsed = questionSchema.parse({
      ...wireQuestion,
      answer: null,
      isAdminAnswer: false,
      asker: null,
    });

    expect(parsed.answer).toBeNull();
    expect(parsed.asker).toBeNull();
  });

  it('parses a payload that omits the answer column entirely', () => {
    const withoutAnswer: Partial<typeof wireQuestion> = { ...wireQuestion };
    delete withoutAnswer.answer;
    delete withoutAnswer.isAdminAnswer;

    expect(() => questionSchema.parse(withoutAnswer)).not.toThrow();
  });
});
