import { describe, expect, it } from 'vitest';

import { reviewAuthorName } from './review-author';

/**
 * `GET /v1/products/:slug/reviews` has never returned an `authorName` field.
 * It returns `user: { id, firstName, lastName }`, and the storefront read
 * `r.authorName ?? ''`, so every review rendered a blank author and every
 * JSON-LD build threw: `productReviewSchema` requires `author.name` to be at
 * least one character, and that ZodError reached the console on every product
 * page carrying a review.
 *
 * The API already composes exactly this name for its own admin surface
 * (`reviews.service.ts:866` builds `customerName` the same way), so the shape
 * was always available; nothing on the storefront read it.
 */
describe('reviewAuthorName', () => {
  it('composes the name the API actually sends', () => {
    expect(reviewAuthorName({ user: { firstName: 'Amel', lastName: 'Ben Salah' } })).toBe(
      'Amel Ben Salah',
    );
  });

  it('prefers an explicit authorName when one is present', () => {
    // Nothing populates it today, but the field is in the contract and an
    // explicit value must win over a derived one if it ever is.
    expect(reviewAuthorName({ authorName: 'Guest reviewer', user: { firstName: 'Amel' } })).toBe(
      'Guest reviewer',
    );
  });

  it('handles a partial name rather than emitting a stray space', () => {
    expect(reviewAuthorName({ user: { firstName: 'Amel' } })).toBe('Amel');
    expect(reviewAuthorName({ user: { lastName: 'Ben Salah' } })).toBe('Ben Salah');
  });

  it('returns an empty string when no name can be derived, never "undefined"', () => {
    // The caller decides what to do with an unattributable review. The JSON-LD
    // builder drops it, because schema.org requires the name; the review list
    // still shows the rating and the body.
    expect(reviewAuthorName({})).toBe('');
    expect(reviewAuthorName({ user: null })).toBe('');
    expect(reviewAuthorName({ authorName: '   ' })).toBe('');
    expect(reviewAuthorName({ user: { firstName: null, lastName: null } })).toBe('');
  });
});
