/**
 * Stable dedup-key derivation for the dispatch engine (NE4, Risk R5).
 */
import { createHash } from 'crypto';

/**
 * Derive a stable BullMQ dedupe key from the logical identity of a dispatched
 * email — (event, entityId, template). A re-fired domain event hashes to the
 * SAME key, so enqueue's dedupe short-circuit (NE2) turns the second dispatch
 * into a no-op instead of mailing the recipient twice (Risk R5). Namespaced
 * `dispatch:` so it can never collide with NE2's `resend:<logId>` keys.
 */
export function stableDedupeKey(event: string, entityId: string, template: string): string {
  const digest = createHash('sha256').update(`${event}:${entityId}:${template}`).digest('hex');
  return `dispatch:${digest.slice(0, 32)}`;
}
