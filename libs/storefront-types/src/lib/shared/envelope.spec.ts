import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiErrorEnvelopeSchema,
  apiResponseSchema,
  paginationMetaSchema,
  unwrap,
  unwrapPaginated,
} from './envelope';

describe('paginationMetaSchema', () => {
  it('accepts a valid meta object', () => {
    expect(() =>
      paginationMetaSchema.parse({ page: 1, pageSize: 20, total: 137, totalPages: 7 }),
    ).not.toThrow();
  });

  it('rejects negative pageSize', () => {
    expect(() => paginationMetaSchema.parse({ page: 1, pageSize: -1, total: 0 })).toThrow();
  });
});

describe('apiResponseSchema', () => {
  const productSchema = z.object({ id: z.string(), name: z.string() });

  it('parses a valid envelope', () => {
    const parsed = apiResponseSchema(productSchema).parse({
      data: { id: 'p1', name: 'Headphones' },
    });
    expect(parsed.data.name).toBe('Headphones');
  });

  it('rejects an envelope where data fails the inner schema', () => {
    expect(() =>
      apiResponseSchema(productSchema).parse({ data: { id: 'p1', name: 42 } }),
    ).toThrow();
  });
});

describe('unwrap', () => {
  const itemSchema = z.object({ id: z.string() });

  it('returns the inner data', () => {
    expect(unwrap({ data: { id: 'x' } }, itemSchema)).toEqual({ id: 'x' });
  });

  it('throws when shape mismatches', () => {
    expect(() => unwrap({ data: { id: 99 } }, itemSchema)).toThrow();
  });
});

describe('unwrapPaginated', () => {
  const itemSchema = z.array(z.string());

  it('returns data and meta', () => {
    const result = unwrapPaginated(
      { data: ['a', 'b'], meta: { page: 1, pageSize: 2, total: 2, totalPages: 1 } },
      itemSchema,
    );
    expect(result.data).toEqual(['a', 'b']);
    expect(result.meta.total).toBe(2);
  });

  it('throws when meta is missing', () => {
    expect(() => unwrapPaginated({ data: ['a'] }, itemSchema)).toThrow(
      'Expected pagination meta on response envelope',
    );
  });
});

describe('apiErrorEnvelopeSchema', () => {
  it('accepts a valid error envelope', () => {
    expect(() =>
      apiErrorEnvelopeSchema.parse({
        error: { code: 'NOT_FOUND', message: 'Product not found' },
      }),
    ).not.toThrow();
  });

  it('rejects a missing code field', () => {
    expect(() => apiErrorEnvelopeSchema.parse({ error: { message: 'oops' } })).toThrow();
  });
});
