import * as path from 'path';
import { randomUUID } from 'crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { SECURITY_HEADERS } from '@common/middleware';

/**
 * Serve the public uploads directory when the local storage driver is in use.
 *
 * `LocalStorageDriver` writes public files under `<cwd>/uploads/<key>` and
 * returns `${UPLOADS_BASE_URL}/<key>`, which points at this API. Nothing
 * answered that URL, on a default development box (`.env.example` sets the
 * local driver) as much as on the local install profile, so every seeded
 * image and every upload was a 404 until this mount. The S3 driver mounts
 * nothing: the bucket serves.
 *
 * The mount is registered during bootstrap, before Nest wires its
 * middleware at `init()`, so the responses it writes never pass the
 * correlation-id or security-headers middleware and must set both here:
 * the same header set the API sends on every response, and an
 * `X-Request-Id` echoed from the caller or minted. They are not in the
 * request log; a static file hit carries nothing worth a log line.
 *
 * Constitution §3.15-A: no `ETag` and no `Last-Modified`, so the wire never
 * carries a validator and a conditional request is answered with the file,
 * not a 304. Freshness comes from the cache header alone: the asset keys are
 * content addressed, and a re-uploaded brand file at the same key is a day
 * away from every reader at most. A missing file falls through to the API's
 * JSON 404, which carries the `no-store` default.
 *
 * The private root (`uploads-private` by default, `PRIVATE_UPLOADS_DIR`) is
 * refused when it sits inside the served root, so the operator cannot be
 * one variable away from serving originals. Directory listings and dotfiles
 * are off, and `express.static` refuses a path that escapes the root.
 */
export function serveLocalUploads(
  app: NestExpressApplication,
  options: { driver: string | undefined; uploadsRoot: string; privateRoot: string },
): boolean {
  const driver = (options.driver ?? 'local').toLowerCase();
  if (driver === 's3') return false;
  const served = path.resolve(options.uploadsRoot);
  const privateRoot = path.resolve(options.privateRoot);
  if (privateRoot === served || privateRoot.startsWith(served + path.sep)) {
    throw new Error(
      `PRIVATE_UPLOADS_DIR (${privateRoot}) is inside the public uploads root (${served}); originals would be served`,
    );
  }
  app.useStaticAssets(served, {
    prefix: '/uploads/',
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    fallthrough: true,
    etag: false,
    lastModified: false,
    setHeaders: (res: Response, filePath: string) => {
      // The bundled mime table has no AVIF entry, and nosniff makes the browser block octet-stream.
      if (path.extname(filePath).toLowerCase() === '.avif')
        res.setHeader('Content-Type', 'image/avif');
      const req = res.req as Request;
      const incoming = req.headers['x-request-id'];
      const requestId = (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();
      res.setHeader('X-Request-Id', requestId);
      for (const [header, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(header, value);
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  });
  return true;
}
