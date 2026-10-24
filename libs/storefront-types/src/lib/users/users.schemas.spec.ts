import { describe, expect, it } from 'vitest';
import {
  addressSchema,
  createAddressRequestSchema,
  customerUserSchema,
  setDefaultAddressRequestSchema,
  updateAddressRequestSchema,
  updateProfileRequestSchema,
} from './users.schemas';

describe('updateProfileRequestSchema', () => {
  it('accepts a name change', () => {
    expect(() => updateProfileRequestSchema.parse({ firstName: 'Jane' })).not.toThrow();
  });

  it('rejects email change without currentPassword', () => {
    expect(() => updateProfileRequestSchema.parse({ email: 'a@b.co' })).toThrow();
  });

  it('accepts email change with currentPassword', () => {
    expect(() =>
      updateProfileRequestSchema.parse({ email: 'a@b.co', currentPassword: 'old' }),
    ).not.toThrow();
  });

  it('rejects invalid locale', () => {
    expect(() => updateProfileRequestSchema.parse({ locale: 'EN' })).toThrow();
  });

  it('accepts a locale like "en" or "en-US"', () => {
    expect(() => updateProfileRequestSchema.parse({ locale: 'en' })).not.toThrow();
    expect(() => updateProfileRequestSchema.parse({ locale: 'en-US' })).not.toThrow();
  });
});

describe('createAddressRequestSchema', () => {
  it('accepts a complete address', () => {
    expect(() =>
      createAddressRequestSchema.parse({
        fullName: 'Jane Doe',
        phone: '+97412345678',
        addressLine1: '1 Main',
        city: 'Lyon',
        country: 'QA',
      }),
    ).not.toThrow();
  });

  it('rejects lowercase country', () => {
    expect(() =>
      createAddressRequestSchema.parse({
        fullName: 'J',
        phone: '+97412345678',
        addressLine1: '1 Main',
        city: 'Lyon',
        country: 'qa',
      }),
    ).toThrow();
  });

  it('rejects malformed phone', () => {
    expect(() =>
      createAddressRequestSchema.parse({
        fullName: 'J',
        phone: '++abc',
        addressLine1: '1 Main',
        city: 'Lyon',
        country: 'QA',
      }),
    ).toThrow();
  });
});

describe('updateAddressRequestSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateAddressRequestSchema.parse({ city: 'Lusail' })).not.toThrow();
  });
});

describe('setDefaultAddressRequestSchema', () => {
  it('accepts both flags', () => {
    expect(() =>
      setDefaultAddressRequestSchema.parse({ isDefaultShipping: true, isDefaultBilling: false }),
    ).not.toThrow();
  });

  it('accepts empty payload', () => {
    expect(() => setDefaultAddressRequestSchema.parse({})).not.toThrow();
  });
});

describe('addressSchema', () => {
  it('parses a stored address', () => {
    expect(() =>
      addressSchema.parse({
        id: 'addr1',
        fullName: 'Jane',
        phone: '+97412345678',
        addressLine1: '1 Main',
        city: 'Lyon',
        country: 'QA',
      }),
    ).not.toThrow();
  });
});

describe('customerUserSchema', () => {
  it('parses a profile with addresses', () => {
    expect(() =>
      customerUserSchema.parse({
        id: 'u1',
        email: 'a@b.co',
        firstName: 'Jane',
        lastName: 'Doe',
        addresses: [],
      }),
    ).not.toThrow();
  });
});
