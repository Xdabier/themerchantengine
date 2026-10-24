import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from './idempotency.service';
import { IDEMPOTENCY_REDIS_CLIENT } from './idempotency.constants';

interface MockRedis {
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
}

function makeRedis(): MockRedis {
  return {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };
}

const SCOPE = 'orders';
const KEY = '550e8400-e29b-41d4-a716-446655440000';
const CALLER_A = 'a'.repeat(64);
const CALLER_B = 'b'.repeat(64);
const BODY_A = IdempotencyService.sha256Hex('{"a":1}');
const BODY_B = IdempotencyService.sha256Hex('{"b":2}');

async function makeService(redis: MockRedis) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [IdempotencyService, { provide: IDEMPOTENCY_REDIS_CLIENT, useValue: redis }],
  }).compile();
  return module.get(IdempotencyService);
}

describe('IdempotencyService', () => {
  describe('beginRequest', () => {
    it('returns fresh when SET NX succeeds', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue('OK');
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({ state: 'fresh' });
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('returns cached when stored entry is complete + caller + body match', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'complete',
          callerHash: CALLER_A,
          bodyHash: BODY_A,
          entityId: 'order-1',
          responseJson: { id: 'order-1', orderNumber: 'ORD-1' },
        }),
      );
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({
        state: 'cached',
        cachedResponse: { id: 'order-1', orderNumber: 'ORD-1' },
      });
    });

    it('returns forbidden when stored entry has a different callerHash', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'complete',
          callerHash: CALLER_A,
          bodyHash: BODY_A,
          entityId: 'order-1',
          responseJson: { id: 'order-1' },
        }),
      );
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_B,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({ state: 'forbidden' });
    });

    it('returns conflict when stored entry has same caller + different body', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'complete',
          callerHash: CALLER_A,
          bodyHash: BODY_A,
          entityId: 'order-1',
          responseJson: { id: 'order-1' },
        }),
      );
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_B,
      });

      expect(result).toEqual({ state: 'conflict' });
    });

    it('returns in-flight when stored entry has same caller + body but status is in-flight', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'in-flight',
          callerHash: CALLER_A,
          bodyHash: BODY_A,
        }),
      );
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({ state: 'in-flight' });
    });

    it('returns fresh fail-open when SET NX throws', async () => {
      const redis = makeRedis();
      redis.set.mockRejectedValue(new Error('redis down'));
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({ state: 'fresh' });
    });

    it('returns fresh when SET NX collides but the entry has evaporated by the GET', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(null);
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({ state: 'fresh' });
    });

    it('returns fresh when GET throws after SET NX collision', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue(null);
      redis.get.mockRejectedValue(new Error('redis flapping'));
      const svc = await makeService(redis);

      const result = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(result).toEqual({ state: 'fresh' });
    });

    it('does not leak the raw key in any log line', async () => {
      const redis = makeRedis();
      redis.set.mockRejectedValue(new Error('redis down'));
      const svc = await makeService(redis);
      const warnSpy = jest.spyOn(svc['logger'], 'warn').mockImplementation();

      await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]?.[0] as string;
      expect(message).not.toContain(KEY);
      expect(message).toContain(IdempotencyService.shortKeyHash(KEY));
    });

    it('partitions Redis keys by scope so different scopes do not collide', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue('OK');
      const svc = await makeService(redis);

      await svc.beginRequest({
        scope: 'orders',
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });
      await svc.beginRequest({
        scope: 'inventory-adjust',
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });

      const firstKey = redis.set.mock.calls[0]?.[0] as string;
      const secondKey = redis.set.mock.calls[1]?.[0] as string;
      expect(firstKey).toContain(':orders:');
      expect(secondKey).toContain(':inventory-adjust:');
      expect(firstKey).not.toBe(secondKey);
    });

    it('writes the same Redis key for two callers using the same raw key — collision is by design so the forbidden branch can fire', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue('OK');
      const svc = await makeService(redis);

      await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });
      await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_B,
        bodyHash: BODY_A,
      });

      const firstKey = redis.set.mock.calls[0]?.[0] as string;
      const secondKey = redis.set.mock.calls[1]?.[0] as string;
      // Same scope + same rawKey → same Redis key, independent of caller.
      // Under real contention the second SET NX would collide and the
      // state machine reads the stored callerHash to decide cached /
      // forbidden / conflict — see the next test.
      expect(firstKey).toBe(secondKey);
    });

    it('returns forbidden when caller A claims the key first and caller B later collides on SET NX', async () => {
      const redis = makeRedis();
      // First call (caller A) wins the SET NX.
      redis.set.mockResolvedValueOnce('OK');
      // Second call (caller B) — SET NX collides, GET surfaces A's entry.
      redis.set.mockResolvedValueOnce(null);
      redis.get.mockResolvedValueOnce(
        JSON.stringify({
          status: 'in-flight',
          callerHash: CALLER_A,
          bodyHash: BODY_A,
        }),
      );
      const svc = await makeService(redis);

      const firstResult = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
      });
      const secondResult = await svc.beginRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_B,
        bodyHash: BODY_A,
      });

      expect(firstResult).toEqual({ state: 'fresh' });
      expect(secondResult).toEqual({ state: 'forbidden' });
    });
  });

  describe('completeRequest', () => {
    it('writes the final response with TTL', async () => {
      const redis = makeRedis();
      redis.set.mockResolvedValue('OK');
      const svc = await makeService(redis);

      await svc.completeRequest({
        scope: SCOPE,
        key: KEY,
        callerHash: CALLER_A,
        bodyHash: BODY_A,
        entityId: 'order-42',
        responseJson: { id: 'order-42', orderNumber: 'ORD-42' },
      });

      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, mode, ttl] = redis.set.mock.calls[0] as [string, string, string, number];
      expect(key).toContain(':orders:');
      const stored = JSON.parse(value);
      expect(stored.status).toBe('complete');
      expect(stored.entityId).toBe('order-42');
      expect(stored.responseJson).toEqual({ id: 'order-42', orderNumber: 'ORD-42' });
      expect(mode).toBe('EX');
      expect(ttl).toBe(24 * 60 * 60);
    });

    it('swallows Redis errors and still resolves', async () => {
      const redis = makeRedis();
      redis.set.mockRejectedValue(new Error('redis down'));
      const svc = await makeService(redis);

      await expect(
        svc.completeRequest({
          scope: SCOPE,
          key: KEY,
          callerHash: CALLER_A,
          bodyHash: BODY_A,
          entityId: 'order-42',
          responseJson: { id: 'order-42' },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('abortRequest', () => {
    it('deletes the sentinel so future retries are fresh', async () => {
      const redis = makeRedis();
      redis.del.mockResolvedValue(1);
      const svc = await makeService(redis);

      await svc.abortRequest({ scope: SCOPE, key: KEY, callerHash: CALLER_A });

      expect(redis.del).toHaveBeenCalledTimes(1);
      const [deletedKey] = redis.del.mock.calls[0] as [string];
      expect(deletedKey).toContain(':orders:');
    });

    it('swallows Redis errors', async () => {
      const redis = makeRedis();
      redis.del.mockRejectedValue(new Error('redis down'));
      const svc = await makeService(redis);

      await expect(
        svc.abortRequest({ scope: SCOPE, key: KEY, callerHash: CALLER_A }),
      ).resolves.toBeUndefined();
    });
  });

  describe('stableStringify', () => {
    it('sorts keys so payload-order does not change the hash', () => {
      const a = IdempotencyService.stableStringify({ b: 1, a: 2 });
      const b = IdempotencyService.stableStringify({ a: 2, b: 1 });
      expect(a).toBe(b);
    });

    it('handles nested objects and arrays', () => {
      const a = IdempotencyService.stableStringify({
        nested: { c: 3, a: 1, b: [{ y: 2, x: 1 }, 0] },
      });
      const b = IdempotencyService.stableStringify({
        nested: { a: 1, b: [{ x: 1, y: 2 }, 0], c: 3 },
      });
      expect(a).toBe(b);
    });

    it('preserves null and primitive shapes', () => {
      expect(IdempotencyService.stableStringify(null)).toBe('null');
      expect(IdempotencyService.stableStringify(42)).toBe('42');
      expect(IdempotencyService.stableStringify('x')).toBe('"x"');
      expect(IdempotencyService.stableStringify(undefined)).toBe(undefined);
    });
  });

  describe('shortKeyHash', () => {
    it('returns the first 16 hex chars of sha256(rawKey)', () => {
      const out = IdempotencyService.shortKeyHash(KEY);
      expect(out).toHaveLength(16);
      expect(out).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
