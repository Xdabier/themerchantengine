import {
  createError,
  defineEventHandler,
  getHeader,
  readBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from 'h3';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import {
  __setDefaultDedupStoreForTests,
  getDefaultDedupStore,
  InMemoryDedupStore,
  type DedupStore,
} from '../../../lib/dedup-store';

/**
 * `/api/_internal/revalidate` — backend-to-backend webhook receiver.
 *
 * Triggered by the API on product/category/CMS write events
 * (`apps/api/src/modules/webhooks/revalidation.listener.ts`). On a valid
 * request, invalidates the storefront's SSR cache for each affected path
 * so the next visitor renders fresh HTML.
 *
 * Auth: shared secret in header `X-Revalidate-Secret` compared via
 * `crypto.timingSafeEqual` against `STOREFRONT_REVALIDATE_SECRET`. A
 * missing or wrong secret returns 401 with no body details.
 *
 * Idempotency (constitution §3.6 + S21.7 admin-security-reviewer H-1):
 * caller-supplied `eventId` (UUID v4) is recorded in a Redis-backed
 * dedup store with a 12 h TTL via SET NX. A duplicate `eventId` returns
 * 200 with `deduped: true` rather than re-invalidating. The store is
 * cluster-wide so horizontal scale-out cannot replay a captured
 * `(secret, eventId)` against a sibling pod within the TTL window.
 * In-memory fallback is dev-only — the boot guard in
 * `getDefaultDedupStore()` throws at first use when `NODE_ENV=production`
 * and `REDIS_HOST` is unset.
 *
 * Logging: never echoes the secret nor the body in full. Logs only the
 * structured envelope `{ paths, reason, eventId, deduped }`.
 */

const REVALIDATE_REASONS = ['product.write', 'category.write', 'cms.write'] as const;

const revalidateBodySchema = z
  .object({
    paths: z.array(z.string().min(1).max(2048)).min(1).max(64),
    reason: z.enum(REVALIDATE_REASONS),
    eventId: z.string().uuid(),
  })
  .strict();

export type RevalidateBody = z.infer<typeof revalidateBodySchema>;

const DEDUP_TTL_MS = 12 * 60 * 60 * 1000;

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function unauthorized(event: H3Event): Record<string, unknown> {
  setResponseStatus(event, 401);
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
  return { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing revalidate secret.' } };
}

export async function handleRevalidate(
  event: H3Event,
  deps?: {
    secret?: string | undefined;
    invalidate?: (path: string) => Promise<void> | void;
    logger?: (entry: Record<string, unknown>) => void;
    dedupStore?: DedupStore;
  },
): Promise<Record<string, unknown>> {
  const secret = deps?.secret ?? process.env['STOREFRONT_REVALIDATE_SECRET'];
  const log =
    deps?.logger ??
    ((entry) => {
      // eslint-disable-next-line no-console
      console.log('[revalidate]', JSON.stringify(entry));
    });
  const dedupStore = deps?.dedupStore ?? getDefaultDedupStore();

  if (!secret) return unauthorized(event);

  const provided = getHeader(event, 'x-revalidate-secret');
  if (!provided) return unauthorized(event);
  if (!timingSafeStringEqual(provided, secret)) return unauthorized(event);

  const raw = await readBody(event);
  const parsed = revalidateBodySchema.safeParse(raw);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
    return {
      error: {
        code: 'INVALID_BODY',
        message: 'Body did not match the revalidate schema.',
        details: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })),
      },
    };
  }

  const { paths, reason, eventId } = parsed.data;

  if (await dedupStore.isDuplicate(eventId)) {
    log({ paths: paths.length, reason, eventId, deduped: true });
    setResponseStatus(event, 200);
    setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
    return { data: { invalidated: 0, eventId, deduped: true } };
  }

  await dedupStore.recordEvent(eventId, DEDUP_TTL_MS);

  for (const path of paths) {
    try {
      await deps?.invalidate?.(path);
    } catch (err) {
      // Per-path failure must not throw — record and continue. The
      // outbound webhook queue will retry the whole event on non-2xx,
      // but partial cache invalidation is acceptable.
      log({
        paths: paths.length,
        reason,
        eventId,
        deduped: false,
        path,
        invalidateError: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  log({ paths: paths.length, reason, eventId, deduped: false });

  setResponseStatus(event, 200);
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
  return { data: { invalidated: paths.length, eventId, deduped: false } };
}

/**
 * Reset the process-wide dedup store. Test-only — exported for unit
 * tests to start each case from a clean slate. Pass `null` to drop the
 * cached default so the next call to `getDefaultDedupStore()` rebuilds
 * (covers REDIS_HOST env-mutation tests). Pass an `InMemoryDedupStore`
 * to reuse a clean instance across cases.
 */
export function __resetDedupForTests(): void {
  __setDefaultDedupStoreForTests(new InMemoryDedupStore());
}

export default defineEventHandler(async (event) => {
  try {
    return await handleRevalidate(event);
  } catch (err) {
    // Catch-all so a thrown h3 error does not surface the secret in the
    // response body. The 500 here is opaque to the caller; log details
    // server-side via the request logger.
    // eslint-disable-next-line no-console
    console.error(
      '[revalidate]',
      JSON.stringify({ error: err instanceof Error ? err.message : 'unknown' }),
    );
    throw createError({ statusCode: 500, statusMessage: 'Revalidation failed.' });
  }
});
