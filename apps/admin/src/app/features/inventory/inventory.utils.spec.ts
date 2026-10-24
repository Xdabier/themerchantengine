import {
  alertTypeTone,
  reasonLabel,
  signedQuantityColor,
  stockStatusLabel,
  stockStatusTone,
} from './inventory.utils';

describe('inventory utils', () => {
  describe('stockStatusTone', () => {
    it('maps OUT_OF_STOCK to error', () => {
      expect(stockStatusTone('OUT_OF_STOCK')).toBe('error');
    });

    it('maps LOW_STOCK to warning', () => {
      expect(stockStatusTone('LOW_STOCK')).toBe('warning');
    });

    it('maps IN_STOCK to success', () => {
      expect(stockStatusTone('IN_STOCK')).toBe('success');
    });

    it('maps an absent status to neutral, never success', () => {
      expect(stockStatusTone(undefined)).toBe('neutral');
    });
  });

  describe('stockStatusLabel', () => {
    it('uses the curated product vocabulary', () => {
      expect(stockStatusLabel('IN_STOCK')).toBe('In stock');
      expect(stockStatusLabel('LOW_STOCK')).toBe('Low stock');
      expect(stockStatusLabel('OUT_OF_STOCK')).toBe('Out of stock');
    });

    it('returns a dash when the row carries no status', () => {
      expect(stockStatusLabel(undefined)).toBe('—');
      expect(stockStatusLabel(null)).toBe('—');
    });
  });

  describe('alertTypeTone', () => {
    it('maps OUT_OF_STOCK to error', () => {
      expect(alertTypeTone('OUT_OF_STOCK')).toBe('error');
    });

    it('maps LOW_STOCK to warning', () => {
      expect(alertTypeTone('LOW_STOCK')).toBe('warning');
    });
  });

  describe('reasonLabel', () => {
    it('title-cases underscore-separated reasons', () => {
      expect(reasonLabel('RETURN_RESTOCK')).toBe('Return Restock');
    });

    it('returns em-dash for null/undefined', () => {
      expect(reasonLabel(null)).toBe('—');
      expect(reasonLabel(undefined)).toBe('—');
    });
  });

  describe('signedQuantityColor', () => {
    it('returns success green for positive', () => {
      expect(signedQuantityColor(5)).toBe('text-status-success');
    });

    it('returns error red for negative', () => {
      expect(signedQuantityColor(-1)).toBe('text-status-error');
    });

    it('returns neutral for zero', () => {
      expect(signedQuantityColor(0)).toBe('text-ink-muted');
    });
  });
});
