import { describe, expect, it } from 'vitest';
import { createReturnRequestSchema, listReturnsQuerySchema, returnSchema } from './returns.schemas';

describe('createReturnRequestSchema', () => {
  it('accepts a basic refund return', () => {
    expect(() =>
      createReturnRequestSchema.parse({
        items: [{ orderItemId: 'oi1', quantity: 1 }],
        reason: 'DEFECTIVE',
      }),
    ).not.toThrow();
  });

  it('accepts an exchange when every item has exchangeVariantId', () => {
    expect(() =>
      createReturnRequestSchema.parse({
        items: [{ orderItemId: 'oi1', quantity: 1, exchangeVariantId: 'v2' }],
        reason: 'WRONG_SIZE',
        refundMethod: 'EXCHANGE',
      }),
    ).not.toThrow();
  });

  it('rejects an exchange when an item lacks exchangeVariantId', () => {
    expect(() =>
      createReturnRequestSchema.parse({
        items: [{ orderItemId: 'oi1', quantity: 1 }],
        reason: 'WRONG_SIZE',
        refundMethod: 'EXCHANGE',
      }),
    ).toThrow();
  });

  it('rejects empty items array', () => {
    expect(() => createReturnRequestSchema.parse({ items: [], reason: 'CHANGED_MIND' })).toThrow();
  });

  it('rejects unknown reason', () => {
    expect(() =>
      createReturnRequestSchema.parse({
        items: [{ orderItemId: 'oi1', quantity: 1 }],
        reason: 'UNKNOWN',
      }),
    ).toThrow();
  });
});

describe('listReturnsQuerySchema', () => {
  it('accepts pagination', () => {
    expect(() => listReturnsQuerySchema.parse({ page: 1, pageSize: 10 })).not.toThrow();
  });
});

describe('returnSchema', () => {
  it('parses a return record', () => {
    expect(() =>
      returnSchema.parse({
        id: 'ret1',
        orderId: 'ord1',
        status: 'REQUESTED',
        reason: 'DEFECTIVE',
        items: [{ orderItemId: 'oi1', quantity: 1 }],
        createdAt: '2026-04-25T10:00:00Z',
      }),
    ).not.toThrow();
  });
});
