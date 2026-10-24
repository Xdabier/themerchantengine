import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryDedupStore,
  __setDefaultDedupStoreForTests,
  getDefaultDedupStore,
} from '../lib/dedup-store';

describe('InMemoryDedupStore (S21.7b H-1 fallback)', () => {
  it('returns false when the key has not been recorded', async () => {
    const store = new InMemoryDedupStore();
    expect(await store.isDuplicate('alpha')).toBe(false);
  });

  it('returns true after recordEvent within the TTL window', async () => {
    const store = new InMemoryDedupStore();
    await store.recordEvent('alpha', 60_000);
    expect(await store.isDuplicate('alpha')).toBe(true);
  });

  it('returns false after the TTL elapses', async () => {
    const store = new InMemoryDedupStore();
    await store.recordEvent('alpha', 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await store.isDuplicate('alpha')).toBe(false);
  });

  it('reset() clears all entries', async () => {
    const store = new InMemoryDedupStore();
    await store.recordEvent('alpha', 60_000);
    store.reset();
    expect(await store.isDuplicate('alpha')).toBe(false);
  });
});

describe('getDefaultDedupStore() resolution', () => {
  const previousHost = process.env['REDIS_HOST'];
  const previousNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    __setDefaultDedupStoreForTests(null);
    delete process.env['REDIS_HOST'];
    // Every label outside `test` and `development` reads as production now
    // (the shared predicate), so the fallback cases run under `test`.
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    __setDefaultDedupStoreForTests(null);
    if (previousHost === undefined) delete process.env['REDIS_HOST'];
    else process.env['REDIS_HOST'] = previousHost;
    if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = previousNodeEnv;
  });

  it('falls back to InMemoryDedupStore when REDIS_HOST is unset and NODE_ENV is test', () => {
    const store = getDefaultDedupStore();
    expect(store).toBeInstanceOf(InMemoryDedupStore);
  });

  it('throws when NODE_ENV=production and REDIS_HOST is unset (boot guard)', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => getDefaultDedupStore()).toThrow(/REDIS_HOST is required in production/);
  });

  it.each([['staging'], ['prod'], [undefined]])(
    'throws under NODE_ENV=%s too, because every label outside test and development is production',
    (label) => {
      if (label === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = label;
      expect(() => getDefaultDedupStore()).toThrow(/REDIS_HOST is required in production/);
    },
  );

  it('returns a single instance across calls (lazy-init cache)', () => {
    const a = getDefaultDedupStore();
    const b = getDefaultDedupStore();
    expect(a).toBe(b);
  });
});
