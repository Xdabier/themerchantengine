import { describe, expect, it } from 'vitest';
import { entityIdSchema, orderNumberSchema, slugSchema, uuidV4Schema } from './ids';

describe('entityIdSchema', () => {
  it.each(['cl3kj1z2x0001qz9b8h7g6f5e', 'b25aBcDef_-123', '550e8400-e29b-41d4-a716-446655440000'])(
    'accepts %s',
    (value) => {
      expect(() => entityIdSchema.parse(value)).not.toThrow();
    },
  );

  it('rejects empty string', () => {
    expect(() => entityIdSchema.parse('')).toThrow();
  });

  it('rejects whitespace', () => {
    expect(() => entityIdSchema.parse('has space')).toThrow();
  });
});

describe('uuidV4Schema', () => {
  it('accepts a canonical v4 UUID', () => {
    expect(() => uuidV4Schema.parse('f47ac10b-58cc-4372-a567-0e02b2c3d479')).not.toThrow();
  });

  it('rejects a v1 UUID', () => {
    expect(() => uuidV4Schema.parse('e0bd9700-1c8b-11ed-861d-0242ac120002')).toThrow();
  });

  it('rejects a non-UUID string', () => {
    expect(() => uuidV4Schema.parse('not-a-uuid')).toThrow();
  });
});

describe('slugSchema', () => {
  it.each(['headphones-pro', 'home-essentials', 'a1', 'a-1-b'])('accepts %s', (value) => {
    expect(() => slugSchema.parse(value)).not.toThrow();
  });

  it.each(['-leading', 'trailing-', 'WITH_CAPS', 'has space', 'double--dash', ''])(
    'rejects %s',
    (value) => {
      expect(() => slugSchema.parse(value)).toThrow();
    },
  );
});

describe('orderNumberSchema', () => {
  it.each(['ORD-000123', 'AKL2026-0042', 'AKL_2026_0001'])('accepts %s', (value) => {
    expect(() => orderNumberSchema.parse(value)).not.toThrow();
  });

  it('rejects lowercase', () => {
    expect(() => orderNumberSchema.parse('ord-1')).toThrow();
  });
});
