import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A page-server companion must never parse its query out of the request url.
 *
 * It looks like the obvious thing to write, it works on the dev server, and it
 * is wrong on a production build: Analog resolves the endpoint over an internal
 * `$fetch` that strips the search, so `event.node.req.url` and
 * `event.node.req.originalUrl` are both the bare
 * `/api/_analog/pages/<locale>/...` path. `/fr/catalog?brand=X` shipped the
 * whole catalogue to production for exactly this reason. `lib/loader-query.ts`
 * carries the mechanism.
 *
 * The behavioural guards (`ssr-loaders-query.spec.ts`,
 * `analog-loader-query.interceptor.spec.ts`,
 * `storefront-e2e/src/catalog-query-ssr.journey.spec.ts`) cover the loaders that
 * exist. This one covers the loader someone writes next, which is the half the
 * original defect got wrong twice: the file that shipped it carried a comment
 * describing the correct fallback, and the fallback was never written.
 */

const PAGES_DIR = __dirname;

/**
 * Every spelling that resolves to the same stripped url. `event.path`,
 * `event.context.query` and h3's `getQuery(event)` all derive from the same
 * `req.url` the internal `$fetch` handed over, so each is a different way to
 * write the same defect. A loader has no legitimate use for any of them: the
 * api-client factory takes the whole request, and the locale comes from the
 * route param.
 */
const INBOUND_URL =
  /\breq(?:uest)?\.(?:url|originalUrl)\b|\bgetQuery\(|\bevent\.path\b|\bevent\.context\.query\b/;

function loaderFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...loaderFiles(full));
    } else if (entry.endsWith('.server.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relative(path: string): string {
  return path.slice(PAGES_DIR.length + 1).replace(/\\/g, '/');
}

describe('page-server companions read the query through loaderSearchParams', () => {
  const files = loaderFiles(PAGES_DIR);

  it('finds the loaders (a broken walk would pass this file vacuously)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((file) => ({ file, name: relative(file) })))(
    '$name never reads the inbound url',
    ({ file, name }) => {
      const source = readFileSync(file, 'utf8');

      expect(
        INBOUND_URL.test(source),
        `${name} reads the inbound url. On a production build that url has no ` +
          'query: the search arrives on a header instead, and `originalUrl`, ' +
          '`event.path`, `event.context.query` and `getQuery(event)` are all the ' +
          'same bare path. Read the query with ' +
          '`loaderSearchParams(event.node.req as ServerRequest)` from ' +
          '`lib/loader-query.ts`.',
      ).toBe(false);
    },
  );
});
