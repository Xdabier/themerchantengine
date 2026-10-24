/**
 * Fail-closed test-target guard, shared by all three e2e harnesses.
 *
 * Plan H / Phase H0. Between 2026-05-02 and 2026-05-15 the admin Playwright
 * suite wrote its fixtures into the developer's DEV database: 127 fake
 * shipping zones, 10 live promotions, four webhooks pointing at
 * `example.com`, and the store's contact email overwritten with a
 * `merchants.test` address. Nothing objected, because nothing ever asked the
 * API which database it was holding. `/health` cannot answer that: it returns
 * `{ status, timestamp }` and is registered outside the global prefix, so it
 * answers 200 on a dev instance as readily as on a test one.
 *
 * There were three ways in, and they are all the same hole:
 *   - a documented escape hatch that proxied the suite at the dev API;
 *   - a stale server squatting the test port, adopted on a health check alone;
 *   - a `BASE_URL` override pointed at the dev admin.
 *
 * So the check is not "is something listening" but "is this OUR database", and
 * it is fail-closed: an API that does not implement the route (a stale build),
 * that answers anything but 200, or that reports any env but `test` or any
 * database not ending in `_test` aborts the run BEFORE a single spec writes.
 *
 * Dependency-free on purpose: `apps/api/tsconfig.app.json` type-checks
 * `scripts/**`, and three different runtimes import this (ts-jest, Playwright's
 * transpiler, and plain ts-node).
 */

/** What `GET <base>/v1/health/identity` answers. */
export interface ApiIdentity {
  env: string;
  database?: string;
}

/**
 * The base a harness reaches the API on, INCLUDING the global prefix when one
 * is set. `http://localhost:53001` for the unprefixed backend spawn,
 * `http://localhost:53001/api` (or the admin dev server's own origin plus
 * `/api`) for the prefixed ones.
 */
export function identityUrl(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, '')}/v1/health/identity`;
}

function abort(message: string, context: string): never {
  throw new Error(
    `[${context}] refusing to run: ${message}\n` +
      '  This guard exists because e2e fixtures once landed in the DEV database ' +
      'for two weeks (plan H, finding H1).\n' +
      '  Point the harness at the test stack (Postgres 55433, API on the e2e ' +
      'port with NODE_ENV=test), or stop whatever is squatting the port.',
  );
}

/**
 * Abort unless the API at `apiBase` is running in test mode against a database
 * whose name ends in `_test`.
 *
 * Never resolves on doubt. A network error, a 404, a non-JSON body and a
 * missing `env` are all failures: an API too old to carry the route is exactly
 * the stale build this guard is looking for.
 */
export async function assertTestTarget(apiBase: string, context: string): Promise<ApiIdentity> {
  const url = identityUrl(apiBase);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return abort(`${url} is unreachable (${(err as Error).message})`, context);
  }

  if (res.status === 404) {
    return abort(
      `${url} answered 404. The API on this port predates the identity route, ` +
        'so it is a stale build (or one started with a different global prefix) ' +
        'and its database is unknown',
      context,
    );
  }
  if (!res.ok) {
    return abort(`${url} answered ${res.status}`, context);
  }

  let identity: ApiIdentity | undefined;
  try {
    const body = (await res.json()) as { data?: ApiIdentity };
    identity = body?.data;
  } catch {
    return abort(`${url} did not answer JSON`, context);
  }

  if (!identity?.env) {
    return abort(`${url} answered without an env, so it cannot be identified`, context);
  }
  if (identity.env !== 'test') {
    return abort(
      `the API at ${apiBase} reports env "${identity.env}", not "test". ` +
        'It is the dev or production API, and every spec write would land in its database',
      context,
    );
  }
  if (!identity.database || !identity.database.endsWith('_test')) {
    return abort(
      `the API at ${apiBase} is in test mode but holds database ` +
        `"${identity.database ?? 'unknown'}", which is not a _test database`,
      context,
    );
  }

  return identity;
}

/**
 * True when something answers `/health` on the origin at all.
 *
 * Takes the ORIGIN, not the prefixed API base: `/health` is registered outside
 * the global prefix, so `http://localhost:53001/api/health` is a 404 on the
 * very server this is meant to detect.
 *
 * Used before spawning, to turn a silent `EADDRINUSE` into a named failure:
 * the spawn's death only ever reached a log file, while the wait loop passed
 * happily against whatever squatter was already there.
 */
export async function portAnswers(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin.replace(/\/+$/, '')}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
