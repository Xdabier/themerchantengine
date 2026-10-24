import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import {
  IDEMPOTENCY_KEY_PREFIX,
  IDEMPOTENCY_REDIS_CLIENT,
  IDEMPOTENCY_REPLAY_MARKER,
  IDEMPOTENCY_TTL_SECONDS,
} from './idempotency.constants';

/**
 * Shared idempotency primitive (§9.5 I1, constitution §3.6).
 *
 * Wraps the SET NX + body-hash + caller-hash + TTL contract every
 * sensitive-write endpoint needs (`POST /v1/orders`,
 * `PATCH /v1/admin/returns/:id/refund`, `PATCH /v1/admin/inventory/adjust`,
 * `POST /v1/admin/inventory/transfer`, `POST /v1/admin/webhooks/:id/test`).
 *
 * `POST /v1/gift-cards/purchase` was on that list until DR-30 removed the route.
 *
 * Replaces the inline per-module logic flagged by
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.12.
 */

export interface BeginRequestArgs {
  /** Module-level scope namespace (e.g. `'orders'`, `'returns-refund'`). */
  scope: string;
  /** Raw `X-Idempotency-Key` header (UUID v4 — validated by the pipe upstream). */
  key: string;
  /** sha256-hex of `${userId}|${sessionId ?? ''}` (or `${adminId}` for admin endpoints). */
  callerHash: string;
  /** sha256-hex of the stably-serialised request body. */
  bodyHash: string;
}

export type BeginRequestResult =
  | { state: 'fresh' }
  | { state: 'cached'; cachedResponse: unknown }
  | { state: 'conflict' }
  | { state: 'forbidden' }
  | { state: 'in-flight' };

export interface CompleteRequestArgs {
  scope: string;
  key: string;
  callerHash: string;
  bodyHash: string;
  entityId: string;
  responseJson: unknown;
}

export interface AbortRequestArgs {
  scope: string;
  key: string;
  callerHash: string;
}

interface StoredEntry {
  status: 'in-flight' | 'complete';
  callerHash: string;
  bodyHash: string;
  entityId?: string;
  responseJson?: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(IDEMPOTENCY_REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Atomically claims the (scope, key, caller) tuple via SET NX.
   *
   * - `fresh` — caller may proceed with the underlying handler. Service writes
   *   an `in-flight` sentinel that the next caller must match-or-conflict.
   * - `cached` — original response is returned verbatim; handler is skipped.
   * - `conflict` — same key + same caller + different body. 409 by contract.
   * - `forbidden` — same key + different caller. 403 by contract.
   * - `in-flight` — same key + same caller + same body, original request still
   *   processing. Caller decides 409 vs retry-later semantics.
   *
   * On Redis failure: returns `fresh` and logs a warning. Same fail-open
   * semantics as the pre-refactor `tryAcquireIdempotencyKey` helper in
   * `apps/api/src/modules/orders/orders.service.ts:1248` (the DB unique
   * constraint is the safety net).
   */
  async beginRequest(args: BeginRequestArgs): Promise<BeginRequestResult> {
    const redisKey = this.redisKey(args.scope, args.key);
    const keyHash = IdempotencyService.shortKeyHash(args.key);

    const sentinel: StoredEntry = {
      status: 'in-flight',
      callerHash: args.callerHash,
      bodyHash: args.bodyHash,
    };

    let acquired = false;
    try {
      const result = await this.redis.set(
        redisKey,
        JSON.stringify(sentinel),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
      acquired = result === 'OK';
    } catch (err) {
      this.logger.warn(
        `SET NX failed for scope="${args.scope}" keyHash=${keyHash}: ${(err as Error).message}`,
      );
      return { state: 'fresh' };
    }

    if (acquired) {
      return { state: 'fresh' };
    }

    // Key already exists — read current state and decide.
    let stored: StoredEntry | null;
    try {
      const raw = await this.redis.get(redisKey);
      stored = raw ? (JSON.parse(raw) as StoredEntry) : null;
    } catch (err) {
      this.logger.warn(
        `GET failed for scope="${args.scope}" keyHash=${keyHash}: ${(err as Error).message}`,
      );
      stored = null;
    }

    if (!stored) {
      // Cache miss right after SET NX collision — race window with eviction.
      // Treat as fresh; the DB unique-constraint catches duplicate writes.
      return { state: 'fresh' };
    }

    if (stored.callerHash !== args.callerHash) {
      return { state: 'forbidden' };
    }
    if (stored.bodyHash !== args.bodyHash) {
      return { state: 'conflict' };
    }
    if (stored.status === 'complete') {
      return { state: 'cached', cachedResponse: stored.responseJson };
    }
    return { state: 'in-flight' };
  }

  /**
   * Writes the final response to the cache and extends TTL.
   * Idempotent — repeated calls with the same args overwrite the entry.
   */
  async completeRequest(args: CompleteRequestArgs): Promise<void> {
    const redisKey = this.redisKey(args.scope, args.key);
    const keyHash = IdempotencyService.shortKeyHash(args.key);

    const entry: StoredEntry = {
      status: 'complete',
      callerHash: args.callerHash,
      bodyHash: args.bodyHash,
      entityId: args.entityId,
      responseJson: args.responseJson,
    };

    try {
      await this.redis.set(redisKey, JSON.stringify(entry), 'EX', IDEMPOTENCY_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `complete SET failed for scope="${args.scope}" keyHash=${keyHash}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Clears the in-flight sentinel when the underlying handler throws.
   * Without this the key stays claimed for 24h even though no response was
   * cached, blocking legitimate retries until TTL expiry.
   */
  async abortRequest(args: AbortRequestArgs): Promise<void> {
    const redisKey = this.redisKey(args.scope, args.key);
    const keyHash = IdempotencyService.shortKeyHash(args.key);

    try {
      await this.redis.del(redisKey);
    } catch (err) {
      this.logger.warn(
        `abort DEL failed for scope="${args.scope}" keyHash=${keyHash}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Per-request replay marker accessor — set by `beginRequest` when state
   * resolves to `cached`, read by the throttler exemption (see
   * `tasks.md` E1.21 + E1.22 for the cross-package layering decision
   * that keeps the exemption out of this phase).
   *
   * @deprecated Dead code in E1 — no caller writes the marker today; the
   * throttler exemption ships in a future targeted phase. Re-enable
   * `beginRequest` to set `request[IDEMPOTENCY_REPLAY_MARKER] = true` on
   * cached state when the exemption lands. Method retained to keep the
   * public seam stable across that future phase.
   */
  isReplay(request: { [IDEMPOTENCY_REPLAY_MARKER]?: boolean }): boolean {
    return request[IDEMPOTENCY_REPLAY_MARKER] === true;
  }

  /**
   * Stable JSON serialisation with sorted object keys.
   * Same key order across runs guarantees bodyHash stability under
   * controller-pipe field reordering or DTO instance copy.
   */
  static stableStringify(value: unknown): string {
    return stableStringifyInternal(value);
  }

  /** sha256 hex of an arbitrary string. Pure helper. */
  static sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** 16-char prefix of sha256(rawKey) — safe for log emission. */
  static shortKeyHash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
  }

  // The key is scope + key-hash only — NOT caller-hashed — so that two
  // callers using the same raw idempotency key collide on the Redis SET
  // NX and the second caller's GET sees the original caller's stored
  // entry. The state machine compares the full 64-char callerHash field
  // on the stored entry against the requesting callerHash and resolves
  // to `forbidden` on mismatch. If callerSeg were part of the Redis key,
  // each caller would inhabit a disjoint Redis namespace and the 403
  // forbidden branch would be unreachable except via DB-uniqueness
  // collisions (which only orders has).
  private redisKey(scope: string, rawKey: string): string {
    const keySeg = IdempotencyService.shortKeyHash(rawKey);
    return `${IDEMPOTENCY_KEY_PREFIX}:${scope}:${keySeg}`;
  }
}

function stableStringifyInternal(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringifyInternal(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringifyInternal(obj[k])}`);
  return `{${entries.join(',')}}`;
}
