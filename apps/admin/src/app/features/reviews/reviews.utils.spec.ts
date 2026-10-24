import {
  canApprove,
  canReject,
  renderStars,
  reviewAuthorLabel,
  reviewStatusTone,
} from './reviews.utils';

describe('reviews.utils', () => {
  describe('reviewStatusTone', () => {
    it('maps PUBLISHED to success', () => {
      expect(reviewStatusTone('PUBLISHED')).toBe('success');
    });
    it('maps PENDING to warning', () => {
      expect(reviewStatusTone('PENDING')).toBe('warning');
    });
    it('maps HIDDEN to neutral', () => {
      expect(reviewStatusTone('HIDDEN')).toBe('neutral');
    });
    it('maps unknown status to neutral', () => {
      expect(reviewStatusTone('WHATEVER')).toBe('neutral');
    });
  });

  describe('renderStars', () => {
    it('renders 0 stars for 0', () => {
      expect(renderStars(0)).toBe('☆☆☆☆☆');
    });
    it('renders 3 filled + 2 empty for rating 3', () => {
      expect(renderStars(3)).toBe('★★★☆☆');
    });
    it('renders 5 filled for max rating', () => {
      expect(renderStars(5)).toBe('★★★★★');
    });
    it('clamps out-of-range rating', () => {
      expect(renderStars(9)).toBe('★★★★★');
      expect(renderStars(-2)).toBe('☆☆☆☆☆');
    });
    it('treats nullish as zero', () => {
      expect(renderStars(null)).toBe('☆☆☆☆☆');
      expect(renderStars(undefined)).toBe('☆☆☆☆☆');
    });
  });

  describe('reviewAuthorLabel', () => {
    it('returns "Anonymous" when both author and userId missing', () => {
      expect(reviewAuthorLabel(null, null)).toBe('Anonymous');
      expect(reviewAuthorLabel(undefined)).toBe('Anonymous');
    });
    it('joins firstName + lastName when present', () => {
      expect(reviewAuthorLabel({ firstName: 'Sara', lastName: 'Hassan' })).toBe('Sara Hassan');
    });
    it('uses only firstName when lastName is nullish', () => {
      expect(reviewAuthorLabel({ firstName: 'Ada', lastName: null })).toBe('Ada');
    });
    it('falls back to userId when author object is empty', () => {
      expect(reviewAuthorLabel({ firstName: null, lastName: null }, 'user-42')).toBe('user-42');
    });
  });

  describe('canApprove / canReject', () => {
    it('approve only from PENDING or HIDDEN', () => {
      expect(canApprove('PENDING')).toBe(true);
      expect(canApprove('HIDDEN')).toBe(true);
      expect(canApprove('PUBLISHED')).toBe(false);
      expect(canApprove(null)).toBe(false);
    });
    it('reject only from PENDING or PUBLISHED', () => {
      expect(canReject('PENDING')).toBe(true);
      expect(canReject('PUBLISHED')).toBe(true);
      expect(canReject('HIDDEN')).toBe(false);
      expect(canReject(undefined)).toBe(false);
    });
  });
});
