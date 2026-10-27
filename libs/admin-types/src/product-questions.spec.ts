import { productQuestionSchema } from './product-questions';

describe('productQuestionSchema', () => {
  const valid = {
    id: 'q-1',
    productId: 'prod-1',
    question: { default: 'Livré stérile ?', fr: 'Livré stérile ?', en: 'Delivered sterile?' },
    questionLocale: 'en',
    askedById: 'user-1',
    answer: { default: 'Oui', fr: 'Oui', en: 'Yes' },
    answeredBy: 'staff-1',
    isAdminAnswer: true,
    helpfulCount: 0,
    status: 'PUBLISHED',
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
  };

  it('parses a valid Q&A entry with Translatable question + answer', () => {
    expect(() => productQuestionSchema.parse(valid)).not.toThrow();
  });

  it('accepts a null answer (the field is optional Translatable per Prisma)', () => {
    expect(() => productQuestionSchema.parse({ ...valid, answer: null })).not.toThrow();
  });

  it('accepts an anonymous question (askedById null)', () => {
    expect(() => productQuestionSchema.parse({ ...valid, askedById: null })).not.toThrow();
  });

  it('rejects when question is a plain string (Translatable shape required after E5)', () => {
    expect(() => productQuestionSchema.parse({ ...valid, question: 'plain' })).toThrow();
  });

  it('rejects when status is not one of the allowed enum values', () => {
    expect(() => productQuestionSchema.parse({ ...valid, status: 'ARCHIVED' })).toThrow();
  });
});
