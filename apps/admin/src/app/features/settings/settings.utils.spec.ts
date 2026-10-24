import { isIntegrationSecret, isMasked, maskSecret, readSetting } from './settings.utils';

describe('settings utils', () => {
  describe('readSetting', () => {
    it('returns fallback when settings are null', () => {
      expect(readSetting(null, 'general', 'storeName', 'default')).toBe('default');
    });
    it('reads a nested key from the grouped envelope', () => {
      const settings = { general: { storeName: 'Acme' } };
      expect(readSetting(settings, 'general', 'storeName', '')).toBe('Acme');
    });
    it('falls back on missing group', () => {
      expect(readSetting({ other: {} }, 'general', 'storeName', 'fb')).toBe('fb');
    });
  });

  describe('integration secrets', () => {
    it('flags known keys', () => {
      expect(isIntegrationSecret('emailApiKey')).toBe(true);
      expect(isIntegrationSecret('publicToggle')).toBe(false);
    });
    it('masks non-empty strings', () => {
      expect(maskSecret('real-secret')).toBe('***');
      expect(maskSecret('')).toBe('');
      expect(maskSecret(undefined)).toBe('');
    });
    it('isMasked detects the placeholder', () => {
      expect(isMasked('***')).toBe(true);
      expect(isMasked('real')).toBe(false);
    });
  });
});
