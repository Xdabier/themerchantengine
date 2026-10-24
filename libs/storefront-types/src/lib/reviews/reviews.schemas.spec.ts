import { describe, expect, it } from 'vitest';
import {
  createReviewRequestSchema,
  helpfulVoteResponseSchema,
  listReviewsQuerySchema,
  reviewSchema,
  reviewSummaryResponseSchema,
  updateReviewRequestSchema,
} from './reviews.schemas';

describe('createReviewRequestSchema', () => {
  it('accepts a complete review', () => {
    expect(() =>
      createReviewRequestSchema.parse({
        rating: 5,
        title: 'Great',
        body: 'Loved it.',
        assetIds: ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
      }),
    ).not.toThrow();
  });

  it('rejects rating > 5', () => {
    expect(() => createReviewRequestSchema.parse({ rating: 6, body: 'x' })).toThrow();
  });

  it('rejects body > 5000 chars', () => {
    expect(() => createReviewRequestSchema.parse({ rating: 4, body: 'x'.repeat(5001) })).toThrow();
  });

  it('rejects asset id that is not UUID v4', () => {
    expect(() =>
      createReviewRequestSchema.parse({ rating: 4, body: 'x', assetIds: ['cuid_x'] }),
    ).toThrow();
  });
});

describe('updateReviewRequestSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateReviewRequestSchema.parse({ rating: 4 })).not.toThrow();
  });

  it('accepts an empty patch', () => {
    expect(() => updateReviewRequestSchema.parse({})).not.toThrow();
  });
});

describe('listReviewsQuerySchema', () => {
  it('accepts a complete query', () => {
    expect(() =>
      listReviewsQuerySchema.parse({
        page: 1,
        pageSize: 20,
        rating: 5,
        sortBy: 'helpfulCount',
        sortOrder: 'desc',
      }),
    ).not.toThrow();
  });

  it('rejects unknown sortBy', () => {
    expect(() => listReviewsQuerySchema.parse({ sortBy: 'newest' })).toThrow();
  });
});

describe('reviewSummaryResponseSchema', () => {
  it('parses a summary', () => {
    expect(() =>
      reviewSummaryResponseSchema.parse({ averageRating: 4.5, total: 12 }),
    ).not.toThrow();
  });
});

describe('reviewSchema', () => {
  it('parses a published review', () => {
    expect(() =>
      reviewSchema.parse({
        id: 'r1',
        productId: 'p1',
        rating: 5,
        body: 'great',
        helpfulCount: 3,
        status: 'PUBLISHED',
        createdAt: '2026-04-25T10:00:00Z',
      }),
    ).not.toThrow();
  });
});

describe('helpfulVoteResponseSchema', () => {
  it('parses a helpful=true toggle response', () => {
    expect(() => helpfulVoteResponseSchema.parse({ helpful: true })).not.toThrow();
  });

  it('parses a helpful=false toggle response', () => {
    expect(() => helpfulVoteResponseSchema.parse({ helpful: false })).not.toThrow();
  });

  it('rejects a response missing the helpful flag', () => {
    expect(() => helpfulVoteResponseSchema.parse({})).toThrow();
  });
});
