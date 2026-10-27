import {
  formatExpiry,
  formatGiftCardMoney,
  giftCardStatus,
  giftCardStatusTone,
} from './gift-cards.utils';

describe('gift-cards utils', () => {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

  describe('giftCardStatus', () => {
    it('returns inactive when isActive=false', () => {
      expect(giftCardStatus({ isActive: false, expiresAt: null, currentBalance: 50 })).toBe(
        'inactive',
      );
    });

    it('returns expired when expiry is in the past', () => {
      expect(giftCardStatus({ isActive: true, expiresAt: hourAgo, currentBalance: 50 })).toBe(
        'expired',
      );
    });

    it('returns empty when balance is zero', () => {
      expect(giftCardStatus({ isActive: true, expiresAt: null, currentBalance: 0 })).toBe('empty');
    });

    it('returns active for a normal live card', () => {
      expect(giftCardStatus({ isActive: true, expiresAt: tomorrow, currentBalance: 100 })).toBe(
        'active',
      );
    });

    it('accepts Prisma.Decimal string balances', () => {
      expect(
        giftCardStatus({ isActive: true, expiresAt: null, currentBalance: '0' as never }),
      ).toBe('empty');
    });
  });

  describe('giftCardStatusTone', () => {
    it('maps to brand-approved tones', () => {
      expect(giftCardStatusTone('active')).toBe('success');
      expect(giftCardStatusTone('expired')).toBe('error');
      expect(giftCardStatusTone('empty')).toBe('warning');
      expect(giftCardStatusTone('inactive')).toBe('neutral');
    });
  });

  describe('formatGiftCardMoney', () => {
    it('formats in the currency recorded on the card', () => {
      expect(formatGiftCardMoney('50', 'EUR')).toBe('EUR 50.00');
    });

    it('falls back for null', () => {
      expect(formatGiftCardMoney(null, 'EUR')).toBe('—');
    });

    // No USD default any more: an unknown currency renders bare, never invented.
    it('renders a bare amount when the card carries no currency', () => {
      expect(formatGiftCardMoney(50, null)).toBe('50.00');
    });
  });

  describe('formatExpiry', () => {
    it('shows Never for null', () => {
      expect(formatExpiry(null)).toBe('Never');
    });
    it('renders a short date', () => {
      expect(formatExpiry(tomorrow)).toMatch(/\d{4}/);
    });
  });
});
