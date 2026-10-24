import {
  listQuestionsResponseSchema,
  listReviewsResponseSchema,
  questionSchema,
  reviewSchema,
} from './reviews.schemas';

/**
 * Regression guard for the 2026-06-07 admin "Could not load questions" outage.
 *
 * The admin client sends `X-Resolve-Locale: false`, so the backend returns the
 * raw Translatable JSONB (`{ default, fr, en }`) for `question` / `answer` /
 * `title` / `body` — NOT a resolved scalar string. After the E5 migration these
 * schemas must accept the object shape on both list and detail GETs. They typed
 * the fields as `z.string()`, so `.parse()` threw a ZodError on every real
 * response, which the rxjs stream surfaced as the generic "Could not load" banner.
 *
 * These tests feed the EXACT wire shape the backend serves so the parse is
 * exercised against reality, not against a pre-migration fixture.
 */

const META = { page: 1, pageSize: 20, total: 1 };

const questionWire = {
  id: 'q-1111111111111111111111111',
  productId: 'p-1111111111111111111111111',
  askedById: 'u-1111111111111111111111111',
  // The backend serves the raw Translatable object, never a string.
  question: { default: 'Livré stérile ?', fr: 'Livré stérile ?', en: 'Delivered sterile?' },
  questionLocale: 'en',
  status: 'PENDING',
  answer: null,
  answeredBy: null,
  isAdminAnswer: false,
  helpfulCount: 0,
  createdAt: '2026-06-07T10:00:00.000Z',
  updatedAt: '2026-06-07T10:00:00.000Z',
  asker: { id: 'u-1111111111111111111111111', firstName: 'Sara', lastName: 'Hassan' },
  product: { id: 'p-1111111111111111111111111', slug: 'urban-runner-sneakers' },
};

const reviewWire = {
  id: 'r-1111111111111111111111111',
  productId: 'p-1111111111111111111111111',
  userId: 'u-1111111111111111111111111',
  rating: 5,
  // Translatable JSONB — title may be null, body is non-null per Prisma.
  title: { default: 'Excellent', fr: 'Excellent', en: 'Great' },
  body: { default: 'Perfect fit, fast shipping.', en: 'Perfect fit, fast shipping.' },
  locale: 'en',
  verifiedPurchase: true,
  status: 'PUBLISHED',
  helpfulCount: 2,
  createdAt: '2026-06-07T10:00:00.000Z',
  updatedAt: '2026-06-07T10:00:00.000Z',
  user: { id: 'u-1111111111111111111111111', firstName: 'Sara', lastName: 'Hassan' },
  product: { id: 'p-1111111111111111111111111', slug: 'urban-runner-sneakers' },
};

describe('reviews/questions response schemas — Translatable wire shape', () => {
  describe('listQuestionsResponseSchema', () => {
    it('parses a question whose question/answer are Translatable objects', () => {
      expect(() =>
        listQuestionsResponseSchema.parse({ data: [questionWire], meta: META }),
      ).not.toThrow();
    });

    it('parses an answered question (answer is a Translatable object, not null)', () => {
      const answered = {
        ...questionWire,
        answer: { default: 'Oui, stérile.', fr: 'Oui, stérile.', en: 'Yes, sterile.' },
        answeredBy: 'staff-1111111111111111111',
        isAdminAnswer: true,
        status: 'PUBLISHED',
      };
      expect(() =>
        listQuestionsResponseSchema.parse({ data: [answered], meta: META }),
      ).not.toThrow();
    });
  });

  describe('questionSchema', () => {
    it('rejects a plain-string question (the pre-E5 shape that drifted)', () => {
      expect(() => questionSchema.parse({ ...questionWire, question: 'plain string' })).toThrow();
    });

    it('rejects a plain-string answer (Translatable shape required after E5)', () => {
      expect(() => questionSchema.parse({ ...questionWire, answer: 'plain string' })).toThrow();
    });
  });

  describe('listReviewsResponseSchema', () => {
    it('parses a review whose title/body are Translatable objects', () => {
      expect(() =>
        listReviewsResponseSchema.parse({ data: [reviewWire], meta: META }),
      ).not.toThrow();
    });

    it('parses a review with a null title (optional Translatable)', () => {
      expect(() =>
        listReviewsResponseSchema.parse({ data: [{ ...reviewWire, title: null }], meta: META }),
      ).not.toThrow();
    });
  });

  describe('reviewSchema', () => {
    it('rejects a plain-string body (the pre-E5 shape that drifted)', () => {
      expect(() => reviewSchema.parse({ ...reviewWire, body: 'plain string' })).toThrow();
    });
  });
});
