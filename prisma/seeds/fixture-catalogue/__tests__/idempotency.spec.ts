import { describe, it, expect } from 'vitest';
import { FIXTURE_CATALOGUE_PREFIXES, APPEND_ONLY_MODELS } from '../lib/idempotency';

describe('fixture catalogue idempotence prefixes', () => {
  it('exposes the documented scope keys', () => {
    expect(FIXTURE_CATALOGUE_PREFIXES.slug).toBe('fx-');
    expect(FIXTURE_CATALOGUE_PREFIXES.giftCardCode).toBe('FXGIFT');
    expect(FIXTURE_CATALOGUE_PREFIXES.couponCodes).toEqual(['FIXTURE10', 'WELCOME50']);
    expect(FIXTURE_CATALOGUE_PREFIXES.customerEmailDomain).toBe('@fixture.test');
    expect(FIXTURE_CATALOGUE_PREFIXES.inventoryLocationCode).toBe('FIXTURE-MAIN-WH');
  });

  it('lists the constitution §3.4 append-only set the seed must never write', () => {
    expect(APPEND_ONLY_MODELS).toEqual([
      'order',
      'orderItem',
      'inventoryMovement',
      'giftCardTransaction',
      'promotionUsage',
      'auditLogEntry',
      'return',
      'returnItem',
      'invoice',
    ]);
  });
});
