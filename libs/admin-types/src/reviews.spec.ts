import { reviewSchema } from './reviews';

describe('reviewSchema', () => {
  const valid = {
    id: 'rev-1',
    productId: 'prod-1',
    userId: 'user-1',
    title: { default: 'Excellent', fr: 'Excellent', en: 'Great' },
    body: { default: "J'ai adoré.", fr: "J'ai adoré.", en: 'Loved it.' },
    locale: 'en',
    rating: 5,
    verifiedPurchase: true,
    helpfulCount: 0,
    status: 'PUBLISHED',
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
  };

  it('parses a valid review payload with Translatable title + body', () => {
    expect(() => reviewSchema.parse(valid)).not.toThrow();
  });

  it('accepts a null title (the field is optional Translatable per Prisma)', () => {
    expect(() => reviewSchema.parse({ ...valid, title: null })).not.toThrow();
  });

  it('rejects when body is a plain string (Translatable shape required after E5)', () => {
    expect(() => reviewSchema.parse({ ...valid, body: 'plain string' })).toThrow();
  });

  it('rejects when status is not one of the allowed enum values', () => {
    expect(() => reviewSchema.parse({ ...valid, status: 'PURGED' })).toThrow();
  });

  it('rejects when rating is out of [1,5]', () => {
    expect(() => reviewSchema.parse({ ...valid, rating: 6 })).toThrow();
  });
});
