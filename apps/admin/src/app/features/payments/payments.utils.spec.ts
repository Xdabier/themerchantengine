import {
  activeTone,
  displayConfigValue,
  isMasked,
  isSecretKey,
  methodLabel,
  providerLabel,
  testModeTone,
} from './payments.utils';

describe('payments utils', () => {
  describe('providerLabel', () => {
    it('renames known providers', () => {
      expect(providerLabel('stripe')).toBe('Stripe');
      expect(providerLabel('cod')).toBe('Cash on delivery');
    });
    it('falls back to the raw value for unknown providers', () => {
      expect(providerLabel('unknown')).toBe('unknown');
    });
  });

  describe('activeTone', () => {
    it('maps isActive to tone', () => {
      expect(activeTone(true)).toBe('success');
      expect(activeTone(false)).toBe('neutral');
    });
  });

  describe('testModeTone', () => {
    it('surfaces warning only in test mode', () => {
      expect(testModeTone(true)).toBe('warning');
      expect(testModeTone(false)).toBeNull();
    });
  });

  describe('methodLabel', () => {
    it('resolves in the operator locale', () => {
      const name = { default: 'Card', fr: 'Carte bancaire', en: 'Card' } as never;
      expect(methodLabel({ name, code: 'c' }, 'fr', 'xx')).toBe('Carte bancaire');
      expect(methodLabel({ name, code: 'c' }, 'en', 'xx')).toBe('Card');
    });
    it('falls back to default, then code', () => {
      expect(
        methodLabel({ name: { default: 'x', en: 'English' } as never, code: 'c' }, 'fr', 'xx'),
      ).toBe('x');
      expect(methodLabel({ name: { default: 'D' } as never, code: 'c' }, 'fr', 'xx')).toBe('D');
      expect(methodLabel({ name: {} as never, code: 'c' }, 'fr', 'xx')).toBe('c');
    });
  });

  describe('secret helpers', () => {
    it('isSecretKey flags known keys', () => {
      expect(isSecretKey('apiKey')).toBe(true);
      expect(isSecretKey('publishableKey')).toBe(false);
    });
    it('isMasked detects the placeholder', () => {
      expect(isMasked('***')).toBe(true);
      expect(isMasked('real')).toBe(false);
    });
  });

  describe('displayConfigValue', () => {
    it('labels stored secrets without leaking the value', () => {
      expect(displayConfigValue('apiKey', '***')).toBe('Stored (hidden)');
    });
    it('shows plain values for non-secret keys', () => {
      expect(displayConfigValue('publishableKey', 'pk_live_x')).toBe('pk_live_x');
    });
    it('formats booleans + nulls readably', () => {
      expect(displayConfigValue('flag', true)).toBe('Yes');
      expect(displayConfigValue('flag', null)).toBe('—');
    });
  });
});
