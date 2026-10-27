import {
  actionLabel,
  actorLabel,
  diffEntry,
  formatDiffValue,
  resourceLabel,
} from './audit-logs.utils';

describe('audit-logs utils', () => {
  describe('actionLabel', () => {
    it('reads the shared audit vocabulary so the list cannot drift from the feed', () => {
      expect(actionLabel('webhook.delete')).toBe('Webhook Deleted');
      expect(actionLabel('gift_card.update')).toBe('Gift Card Updated');
      expect(actionLabel('review.updated')).toBe('Review Updated');
    });

    it('humanizes actions that are not entity.verb pairs', () => {
      expect(actionLabel('login')).toBe('Login');
      expect(actionLabel(null)).toBe('—');
    });
  });

  describe('diffEntry', () => {
    it('returns only changed keys (sorted)', () => {
      const rows = diffEntry({
        before: { a: 1, b: 'same', c: 'old' },
        after: { a: 2, b: 'same', c: 'new' },
      });
      expect(rows.map((r) => r.key)).toEqual(['a', 'c']);
    });

    it('falls back to `changes` when before/after unchanged', () => {
      const rows = diffEntry({ before: null, after: null, changes: { status: 'ACTIVE' } });
      expect(rows).toEqual([{ key: 'status', before: undefined, after: 'ACTIVE' }]);
    });

    it('treats deep-equal values as unchanged', () => {
      const rows = diffEntry({
        before: { obj: { a: 1 } },
        after: { obj: { a: 1 } },
      });
      expect(rows).toEqual([]);
    });
  });

  describe('formatDiffValue', () => {
    it('truncates long strings', () => {
      expect(formatDiffValue('x'.repeat(200))).toHaveLength(118);
    });
    it('renders null/undefined readably', () => {
      expect(formatDiffValue(null)).toBe('null');
      expect(formatDiffValue(undefined)).toBe('—');
    });
  });

  describe('actorLabel', () => {
    it('returns a capitalised System for nullish', () => {
      expect(actorLabel(null)).toBe('System');
    });
    it('truncates long ids', () => {
      expect(actorLabel('abcdefghijklmnop')).toBe('abcdefghij…');
    });
  });

  describe('resourceLabel', () => {
    it('turns the raw entity type into words', () => {
      expect(resourceLabel('gift_card')).toBe('Gift Card');
      expect(resourceLabel('storefront_config')).toBe('Storefront Config');
      expect(resourceLabel('order')).toBe('Order');
    });
    it('dashes when the entity type is missing', () => {
      expect(resourceLabel(null)).toBe('—');
      expect(resourceLabel(undefined)).toBe('—');
    });
  });
});
