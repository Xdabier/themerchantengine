/**
 * Shared idempotency primitives (`specs/constitution.md` §3.6,
 * `specs/merchants-engine-technical-spec-v2.2.md` §9.5 I1).
 *
 * One injection token per concern keeps the common module decoupled from
 * the per-module Redis clients (orders, products, geo, categories) that
 * already exist under `apps/api/src/modules/<m>/<m>.constants.ts`.
 */

export const IDEMPOTENCY_REDIS_CLIENT = 'IDEMPOTENCY_REDIS_CLIENT';

/** §9.5 I1 — TTL on every idempotency entry. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Redis key namespace. */
export const IDEMPOTENCY_KEY_PREFIX = 'idemp';

/** Per-request marker key — pipe/service write, throttler guard reads. */
export const IDEMPOTENCY_REPLAY_MARKER = Symbol.for('idempotency.replayMarker');
