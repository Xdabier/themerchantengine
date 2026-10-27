import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';

/**
 * Apply the constitution §3.15-A cache-control hardening to a NestJS Express
 * app: disable Express's automatic weak-ETag emitter, and default every
 * response's `Cache-Control` to `no-store` unless a controller has explicitly
 * set a value via `@PublicCacheable(...)` / `@Header('Cache-Control', ...)`.
 *
 * Extracted from `main.ts` so the cache-headers e2e suite can apply the same
 * hardening to its test app without forking the implementation. If the
 * production bootstrap and the test bootstrap drift, the e2e suite is no
 * longer verifying the production posture — keep this the single source.
 *
 * The middleware sets the default header at request entry. Per the Express
 * request lifecycle, controller-level `@Header('Cache-Control', ...)` calls
 * `res.setHeader('Cache-Control', ...)` later in the handler, which
 * overwrites this default. Net effect: `no-store` for everything except the
 * explicit `PublicCacheable`-marked opt-ins and the one static mount:
 * `serveLocalUploads` (`./local-uploads.ts`) sets a public cache header on
 * the content-addressed files it serves for the local storage driver, and a
 * missing file falls through to this default.
 */
export function applyCacheControlHardening(app: NestExpressApplication): void {
  app.disable('etag');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
}
