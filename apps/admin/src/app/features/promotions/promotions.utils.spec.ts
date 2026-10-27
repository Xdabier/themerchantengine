import {
  formatPromotionDiscount,
  promotionLabel,
  promotionStatus,
  promotionStatusTone,
  promotionTypeLabel,
} from './promotions.utils';

describe('promotions utils', () => {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const hourAhead = new Date(Date.now() + 3600_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();

  describe('promotionStatus', () => {
    it('returns inactive when isActive=false', () => {
      expect(promotionStatus({ isActive: false, startsAt: null, endsAt: null })).toBe('inactive');
    });

    it('returns scheduled when startsAt is in the future', () => {
      expect(promotionStatus({ isActive: true, startsAt: hourAhead, endsAt: null })).toBe(
        'scheduled',
      );
    });

    it('returns expired when endsAt has passed', () => {
      expect(promotionStatus({ isActive: true, startsAt: yesterday, endsAt: hourAgo })).toBe(
        'expired',
      );
    });

    it('returns live inside the window', () => {
      expect(promotionStatus({ isActive: true, startsAt: hourAgo, endsAt: hourAhead })).toBe(
        'live',
      );
    });

    it('returns live when active and window is open-ended', () => {
      expect(promotionStatus({ isActive: true, startsAt: null, endsAt: null })).toBe('live');
    });
  });

  describe('promotionStatusTone', () => {
    it('maps to the brand-approved badge tone', () => {
      expect(promotionStatusTone('live')).toBe('success');
      expect(promotionStatusTone('scheduled')).toBe('warning');
      expect(promotionStatusTone('expired')).toBe('error');
      expect(promotionStatusTone('inactive')).toBe('neutral');
    });
  });

  describe('promotionTypeLabel', () => {
    it('renames Prisma enums to UI labels', () => {
      expect(promotionTypeLabel('PERCENTAGE')).toBe('Percent off');
      expect(promotionTypeLabel('FIXED_AMOUNT')).toBe('Fixed off');
      expect(promotionTypeLabel('FREE_SHIPPING')).toBe('Free shipping');
    });

    it('falls back to the raw string for unknown types', () => {
      expect(promotionTypeLabel('CUSTOM')).toBe('CUSTOM');
    });
  });

  describe('formatPromotionDiscount', () => {
    it('formats a percentage with %', () => {
      expect(formatPromotionDiscount({ type: 'PERCENTAGE', value: 20 }, null)).toBe('20%');
    });

    it('labels free shipping', () => {
      expect(formatPromotionDiscount({ type: 'FREE_SHIPPING', value: 0 }, null)).toBe('Shipping');
    });

    it('renders fixed amounts in the store currency', () => {
      expect(formatPromotionDiscount({ type: 'FIXED_AMOUNT', value: 15 }, { code: 'EUR' })).toBe(
        'EUR 15.00',
      );
    });

    // A7: a BOGO promo used to render as money (US$10.00). The backend ignores
    // `value` for this type and gives getQuantity items free per buyQuantity
    // bought, so the quantities are the only truthful label.
    it('describes a BOGO promotion by its quantities, not as money', () => {
      expect(
        formatPromotionDiscount(
          { type: 'BUY_X_GET_Y', value: 10, buyQuantity: 2, getQuantity: 1 },
          { code: 'EUR' },
        ),
      ).toBe('Buy 2, get 1 free');
    });

    it('falls back to the placeholder when a BOGO promo has no quantities', () => {
      expect(formatPromotionDiscount({ type: 'BUY_X_GET_Y', value: 10 }, { code: 'EUR' })).toBe(
        '—',
      );
    });

    it('labels the tier-driven types instead of formatting their value as money', () => {
      expect(formatPromotionDiscount({ type: 'VOLUME_DISCOUNT', value: 10 }, { code: 'EUR' })).toBe(
        'Volume',
      );
      expect(formatPromotionDiscount({ type: 'TIERED_PRICE', value: 10 }, { code: 'EUR' })).toBe(
        'Tiered',
      );
    });

    it('renders a bare amount when the store currency is not hydrated yet', () => {
      expect(formatPromotionDiscount({ type: 'FIXED_AMOUNT', value: 15 }, null)).toBe('15.00');
    });

    it('accepts Prisma.Decimal string values', () => {
      expect(
        formatPromotionDiscount({ type: 'PERCENTAGE', value: '25' as unknown as number }, null),
      ).toBe('25%');
    });
  });

  describe('promotionLabel', () => {
    it('resolves in the operator locale', () => {
      const name = { default: 'Spring Sale', fr: 'Offre de printemps', en: 'Spring Sale' };
      expect(promotionLabel({ name }, 'fr', 'xx')).toBe('Offre de printemps');
      expect(promotionLabel({ name }, 'en', 'xx')).toBe('Spring Sale');
    });

    it('falls back to default, then to any locale', () => {
      expect(promotionLabel({ name: { default: 'X', en: 'Spring Sale' } }, 'fr', 'xx')).toBe('X');
      expect(promotionLabel({ name: { default: 'D' } }, 'fr', 'xx')).toBe('D');
      expect(promotionLabel({ name: { de: 'Rabatt' } as never }, 'fr', 'xx')).toBe('Rabatt');
    });

    it('accepts a plain string for legacy rows', () => {
      expect(promotionLabel({ name: 'Legacy' as never }, 'fr', 'xx')).toBe('Legacy');
    });
  });
});
