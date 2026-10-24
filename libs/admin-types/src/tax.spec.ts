import { taxClassSchema, taxZoneSchema } from './tax';

describe('taxZoneSchema', () => {
  const valid = {
    id: 'zone-tn',
    name: { default: 'France', fr: 'France', en: 'France' },
    countries: ['TN'],
    rate: '0.1900',
    isDefault: false,
    isCompound: false,
    priority: 0,
    isActive: true,
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
    deletedAt: null,
  };

  it('parses a valid TaxZone with Translatable name and Decimal rate as string', () => {
    expect(() => taxZoneSchema.parse(valid)).not.toThrow();
  });

  it('parses a valid TaxZone when rate is already a number', () => {
    expect(() => taxZoneSchema.parse({ ...valid, rate: 0.05 })).not.toThrow();
  });

  it('rejects when name is a plain string (Translatable shape required per DR-21)', () => {
    expect(() => taxZoneSchema.parse({ ...valid, name: 'France' })).toThrow();
  });

  it('rejects when rate is outside [0, 1]', () => {
    expect(() => taxZoneSchema.parse({ ...valid, rate: '1.5' })).toThrow();
  });
});

describe('taxClassSchema', () => {
  const valid = {
    id: 'class-standard-tn',
    zoneId: 'zone-tn',
    name: 'Standard',
    rate: '0.1900',
    isDefault: true,
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
  };

  it('parses a valid TaxClass with plain string name (DR-22 kept-as-String)', () => {
    expect(() => taxClassSchema.parse(valid)).not.toThrow();
  });

  it('parses the four canonical kind tags as plain strings', () => {
    for (const name of ['Standard', 'Reduced', 'Zero-Rated', 'Exempt']) {
      expect(() => taxClassSchema.parse({ ...valid, name })).not.toThrow();
    }
  });

  it('rejects when name is a Translatable object (DR-22 — must stay plain String)', () => {
    expect(() =>
      taxClassSchema.parse({ ...valid, name: { default: 'Standard', en: 'Standard' } }),
    ).toThrow();
  });

  it('rejects when rate is malformed', () => {
    expect(() => taxClassSchema.parse({ ...valid, rate: 'not-a-decimal' })).toThrow();
  });
});
