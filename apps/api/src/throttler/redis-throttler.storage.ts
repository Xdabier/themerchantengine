import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageOptions } from '@nestjs/throttler/dist/throttler-storage-options.interface';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Lua script for atomic rate-limit increment.
 *
 * Arguments:
 *   KEYS[1] — the throttle key
 *   ARGV[1] — TTL in seconds
 *
 * Returns: { currentCount, remainingTtl }
 *
 * Atomicity guarantee: INCR + conditional EXPIRE run as a single Redis operation.
 * If this is the first hit (current == 1) the key is given its TTL, ensuring
 * the window always expires even if the caller crashes between INCR and EXPIRE.
 */
const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  /**
   * Stub — satisfies the ThrottlerStorage interface.
   * The real state lives in Redis; this map is never consulted.
   */
  readonly storage: Record<string, ThrottlerStorageOptions> = {};

  private readonly redis: Redis;

  constructor(redisOptions: { host: string; port: number; password?: string }) {
    this.redis = new Redis({
      host: redisOptions.host,
      port: redisOptions.port,
      password: redisOptions.password,
      // Fail fast in dev; do not retry indefinitely
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  /**
   * Atomically increments the hit counter for `key`.
   *
   * @param key  - Unique throttle key (built by ThrottlerGuard from route + tracker)
   * @param ttl  - Window duration in **seconds** (matches @nestjs/throttler v4 convention)
   * @returns    ThrottlerStorageRecord with totalHits and timeToExpire (seconds)
   */
  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const result = (await this.redis.eval(INCREMENT_SCRIPT, 1, key, String(ttl))) as [
      number,
      number,
    ];

    const [totalHits, timeToExpire] = result;

    return {
      totalHits,
      // Clamp to 0 — shouldn't be negative, but guard against TTL=-1 (no expiry)
      timeToExpire: Math.max(0, timeToExpire),
    };
  }
}
