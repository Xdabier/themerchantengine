import { applyDecorators, Header, SetMetadata } from '@nestjs/common';

export const PUBLIC_CACHEABLE_KEY = 'publicCacheable';

export interface PublicCacheableMetadata {
  /** Seconds the browser may serve the cached value without revalidating. */
  maxAgeSeconds: number;
  /** Request header the response body was chosen from, emitted as `Vary`. */
  varyOn?: string;
}

/**
 * Opt a public read-only endpoint into browser caching by emitting
 * `Cache-Control: public, max-age=<seconds>`. This is the ONLY sanctioned
 * way to override the global `Cache-Control: no-store` default that
 * `apps/api/src/main.ts` applies per constitution §3.15-A.
 *
 * The `PUBLIC_CACHEABLE_KEY` metadata marker is the auditor seam: the
 * `cache-and-bootstrap-auditor` agent greps for `@Header('Cache-Control',
 * ...)` and demands either (a) the call is on a controller method that also
 * carries `@PublicCacheable(N)` OR (b) the file is on the auditor's
 * documented allowlist. Raw `@Header('Cache-Control', ...)` usages without
 * either signal are an unreviewed bypass of §3.15-A and fail the phase
 * exit.
 *
 * Use exclusively for endpoints whose response is public AND not affected
 * by `Authorization` / `Cookie` (otherwise per-user data leaks across
 * shared browser / CDN caches). Examples in this repo: sitemap XML, robots.txt,
 * llms.txt, llms-full.txt. NEVER apply to anything that carries
 * `@Permissions(...)` or returns per-customer data.
 *
 * `varyOn` names the request header the body was chosen from, and is emitted
 * as `Vary`. It is required whenever the handler reads a request header to
 * decide what to send: `public, max-age=N` hands the response to every shared
 * cache in the path, and a cache with no `Vary` to key on serves the first
 * reader's copy to everyone for the whole TTL. The llms surfaces pick their
 * locale from `Accept-Language`, so they pass `'Accept-Language'`; the sitemap
 * and robots surfaces emit one document for every reader and pass nothing.
 * Leave it unset rather than guessing: a `Vary` no response actually varies on
 * fragments a shared cache key for no gain.
 */
export function PublicCacheable(maxAgeSeconds: number, varyOn?: string) {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError(
      `@PublicCacheable: maxAgeSeconds must be a positive integer; got ${String(maxAgeSeconds)}`,
    );
  }
  if (varyOn !== undefined && varyOn.trim() === '') {
    throw new RangeError('@PublicCacheable: varyOn must be a header name, or omitted entirely');
  }
  return applyDecorators(
    SetMetadata(PUBLIC_CACHEABLE_KEY, {
      maxAgeSeconds,
      ...(varyOn ? { varyOn } : {}),
    } satisfies PublicCacheableMetadata),
    Header('Cache-Control', `public, max-age=${maxAgeSeconds}`),
    ...(varyOn ? [Header('Vary', varyOn)] : []),
  );
}
