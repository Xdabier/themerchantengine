import {
  canRun,
  formatMoney,
  orderedTimeline,
  reasonLabel,
  returnStatusTone,
} from './returns.utils';

describe('returns.utils', () => {
  describe('returnStatusTone', () => {
    it('maps terminal success statuses to success tone', () => {
      expect(returnStatusTone('REFUND_PROCESSED')).toBe('success');
      expect(returnStatusTone('CLOSED')).toBe('success');
    });

    it('maps in-flight statuses to info tone', () => {
      expect(returnStatusTone('APPROVED')).toBe('info');
      expect(returnStatusTone('ITEM_RECEIVED')).toBe('info');
    });

    it('maps REQUESTED to warning and REJECTED to error', () => {
      expect(returnStatusTone('REQUESTED')).toBe('warning');
      expect(returnStatusTone('REJECTED')).toBe('error');
    });

    it('falls back to neutral for unknown values', () => {
      expect(returnStatusTone('ALIEN' as never)).toBe('neutral');
    });
  });

  describe('canRun', () => {
    it('lets approvers approve a REQUESTED return', () => {
      expect(canRun('approve', 'REQUESTED')).toBe(true);
    });

    it('blocks approving a REFUND_PROCESSED return', () => {
      expect(canRun('approve', 'REFUND_PROCESSED')).toBe(false);
    });

    it('lets operators mark approved returns as received', () => {
      expect(canRun('receive', 'APPROVED')).toBe(true);
      expect(canRun('receive', 'REQUESTED')).toBe(false);
    });

    it('blocks every action on a CLOSED return', () => {
      const actions = ['approve', 'reject', 'receive', 'refund', 'close'] as const;
      for (const a of actions) expect(canRun(a, 'CLOSED')).toBe(false);
    });
  });

  describe('reasonLabel', () => {
    it('humanises enum screaming-snake values', () => {
      expect(reasonLabel('WRONG_SIZE')).toBe('Wrong Size');
      expect(reasonLabel('NOT_AS_DESCRIBED')).toBe('Not As Described');
    });

    it('returns an em-dash for null/undefined', () => {
      expect(reasonLabel(null)).toBe('—');
      expect(reasonLabel(undefined)).toBe('—');
    });
  });
  describe('formatMoney', () => {
    it('delegates to the shared formatter with the order currency', () => {
      expect(formatMoney(1234.5, 'EUR')).toBe('EUR 1,234.50');
    });

    // No USD default any more: an order with no currency on the wire renders
    // a bare amount rather than an invented one.
    it('renders a bare amount when the order carries no currency', () => {
      expect(formatMoney(1234.5, undefined)).toBe('1,234.50');
    });

    it('returns the placeholder for nullish values', () => {
      expect(formatMoney(null, 'EUR')).toBe('—');
    });
  });

  // ── Plan F, finding F11 ────────────────────────────────────────────────

  describe('orderedTimeline', () => {
    const inOrder = {
      requestedAt: '2026-03-24T09:00:00Z',
      approvedAt: '2026-03-29T10:00:00Z',
      receivedAt: '2026-03-31T12:00:00Z',
      refundedAt: '2026-04-01T09:00:00Z',
    };

    it('keeps stage order when the timestamps agree with it', () => {
      const entries = orderedTimeline(inOrder);
      expect(entries.map((e) => e.stage)).toEqual([
        'requested',
        'approved',
        'received',
        'refunded',
      ]);
      expect(entries.every((e) => !e.outOfOrder)).toBe(true);
    });

    it('sorts by real time and flags the impossible entry', () => {
      // The shape the seed produced: requestedAt defaulted to seed time, months
      // after the return was approved.
      const entries = orderedTimeline({ ...inOrder, requestedAt: '2026-05-24T09:00:00Z' });

      const times = entries.filter((e) => e.at).map((e) => new Date(e.at!).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(entries.find((e) => e.stage === 'requested')?.outOfOrder).toBe(false);
      expect(entries.find((e) => e.stage === 'approved')?.outOfOrder).toBe(true);
    });

    it('falls back to createdAt for the requested stage', () => {
      const entries = orderedTimeline({ createdAt: '2026-03-20T09:00:00Z' });
      expect(entries[0]).toMatchObject({ stage: 'requested', at: '2026-03-20T09:00:00Z' });
    });

    it('puts unset stages last, with a null date and no flag', () => {
      const entries = orderedTimeline({ requestedAt: inOrder.requestedAt });
      expect(entries[0].stage).toBe('requested');
      expect(entries.slice(1).every((e) => e.at === null && !e.outOfOrder)).toBe(true);
      expect(entries.map((e) => e.label)).toContain('Refunded');
    });

    it('returns nothing for a missing record', () => {
      expect(orderedTimeline(null)).toEqual([]);
    });

    it('ignores an unparseable timestamp rather than sorting on NaN', () => {
      const entries = orderedTimeline({ ...inOrder, receivedAt: 'not-a-date' });
      expect(entries.at(-1)).toMatchObject({ stage: 'received', outOfOrder: false });
    });
  });
});
