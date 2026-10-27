import {
  expectNoViolations,
  isCommentLine,
  lineAt,
  readCanary,
  readRepoFile,
  readTree,
  matchAll,
  SourceFile,
  Violation,
} from './lib/repo';
import { Route, hasRouteDecorator, readRoutes } from './lib/controllers';

/**
 * Constitution 3.15-A: Express's weak-ETag emitter is off, `Cache-Control:
 * no-store` is the default on every response, and only a declared public read
 * opts out.
 *
 * Replaces the cache half of the retired `cache-and-bootstrap-auditor`.
 *
 * §3.15-C is covered by `apps/admin/src/app/core/session-bootstrap.spec.ts`
 * and the storefront layout-shell spec. Three of §3.15-B's four obligations
 * are covered by the admin error-normalizer interceptor spec and the two
 * storefront api-client specs, which each drive a real 304 and assert the
 * success shape. The fourth, the `console.error` tripwire in the two error
 * mappers, has no test: deleting it leaves the whole gate green. It is a
 * diagnostic rather than a control, which is why this is recorded rather
 * than fixed here, but the claim that the halves are fully covered would be
 * wrong.
 */
const GUARD = 'api-cache-headers';

const HARDENING_MODULE = 'apps/api/src/bootstrap/cache-control-hardening.ts';

/** The bootstrap is the single source; main.ts must call it. */
const BOOTSTRAP_ENTRY = 'apps/api/src/main.ts';

/** A raw `@Header('Cache-Control', ...)` bypasses the `@PublicCacheable`
 * wrapper, which is where the public-read opt-in is reviewed and where the
 * `Vary` header is set. These files may still use the raw form. */
const RAW_HEADER_ALLOWLIST: readonly string[] = [
  // The hardening module's own spec builds a controller that asserts the raw
  // form still overrides the default.
  'apps/api/src/bootstrap/cache-control-hardening.spec.ts',
];

const RAW_CACHE_HEADER = /@Header\(\s*['"]Cache-Control['"]/;

/** Offset of the first real call, skipping imports and prose. `main.ts`
 * explains the mount order in a comment that names `express.json()`, and the
 * import block names every symbol before any of them runs. */
function firstCall(text: string, pattern: RegExp): number {
  const regex = new RegExp(pattern.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const line = text.slice(lineStart, match.index);
    if (isCommentLine(text, match.index)) continue;
    if (/^\s*import\b/.test(line)) continue;
    return match.index;
  }
  return -1;
}

export function checkBootstrap(hardening: string, entry: string): Violation[] {
  const violations: Violation[] = [];
  // Better Auth consumes its own raw request bodies, so its handler must mount
  // before express.json(). Reordering these breaks the auth handler, and a
  // get-session response escaping the no-store default would put session state
  // in a shared cache. The hardening itself must come before both.
  const authMount = firstCall(entry, /toNodeHandler\(/);
  const jsonMount = firstCall(entry, /express\.json\(/);
  const hardeningCall = firstCall(entry, /applyCacheControlHardening\(/);
  if (authMount !== -1 && jsonMount !== -1 && authMount > jsonMount) {
    violations.push({
      file: BOOTSTRAP_ENTRY,
      line: lineAt(entry, authMount),
      message:
        'the Better Auth handler mounts after express.json(), which consumes the raw body it needs (constitution 3.15-A, DR-24).',
    });
  }
  if (hardeningCall !== -1 && authMount !== -1 && hardeningCall > authMount) {
    violations.push({
      file: BOOTSTRAP_ENTRY,
      line: lineAt(entry, hardeningCall),
      message:
        'the cache hardening is applied after the auth handler mounts, so auth responses skip the no-store default (constitution 3.15-A).',
    });
  }
  if (!/bodyParser:\s*false/.test(entry)) {
    violations.push({
      file: BOOTSTRAP_ENTRY,
      line: 1,
      message:
        "NestFactory.create is not configured with `bodyParser: false`, so Nest's parser consumes the body Better Auth reads raw (DR-24).",
    });
  }
  if (!/app\.disable\(\s*['"]etag['"]\s*\)/.test(hardening)) {
    violations.push({
      file: HARDENING_MODULE,
      line: 1,
      message:
        "app.disable('etag') is absent. Express's weak ETag drives the 304 cascade (constitution 3.15-A).",
    });
  }
  if (!/setHeader\(\s*['"]Cache-Control['"]\s*,\s*['"]no-store['"]\s*\)/.test(hardening)) {
    violations.push({
      file: HARDENING_MODULE,
      line: 1,
      message:
        "the global 'Cache-Control: no-store' default middleware is absent (constitution 3.15-A).",
    });
  }
  if (!/applyCacheControlHardening\(\s*app\s*\)/.test(entry)) {
    violations.push({
      file: BOOTSTRAP_ENTRY,
      line: 1,
      message:
        'the API bootstrap does not call applyCacheControlHardening(app) (constitution 3.15-A).',
    });
  }
  return violations;
}

/** Constitution 3.15-A: only a public read opts into browser caching. A
 * `@PublicCacheable` on an authenticated route puts per-user data in shared
 * and intermediary caches, which is the 2026-05-16 incident class. The raw
 * `@Header` form is banned above, so this decorator is now the only path into
 * caching and it is the only place left to check. */
export function checkPublicCacheable(routes: readonly Route[]): Violation[] {
  const violations: Violation[] = [];
  for (const route of routes) {
    if (!hasRouteDecorator(route, 'PublicCacheable')) continue;
    if (hasRouteDecorator(route, 'Public')) continue;
    violations.push({
      file: route.file,
      line: route.line,
      message: `${route.verb} /${route.path} is @PublicCacheable but not @Public(). A cached authenticated response is shared between users (constitution 3.15-A).`,
    });
  }
  return violations;
}

export function checkRawHeaders(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (RAW_HEADER_ALLOWLIST.includes(file.path)) continue;
    violations.push(
      ...matchAll(
        file,
        RAW_CACHE_HEADER,
        () =>
          "@Header('Cache-Control', ...) set directly. Use @PublicCacheable(maxAge) so the opt-in is reviewable and carries its Vary (constitution 3.15-A).",
        { skipComments: true },
      ),
    );
  }
  return violations;
}

describe(GUARD, () => {
  const apiFiles = readTree({ dirs: ['apps/api/src'], extensions: ['.ts'] });
  const routes = readRoutes(apiFiles.filter((f) => f.path.endsWith('.controller.ts')));

  it('keeps ETag disabled and no-store the default, wired from the bootstrap', () => {
    expectNoViolations(
      checkBootstrap(readRepoFile(HARDENING_MODULE), readRepoFile(BOOTSTRAP_ENTRY)),
    );
  });

  it('finds no raw Cache-Control header outside the allowlist', () => {
    expectNoViolations(checkRawHeaders(apiFiles));
  });

  it('finds every cache opt-in on a public route', () => {
    expectNoViolations(checkPublicCacheable(routes));
  });

  it('reads the cache opt-ins, so a selector regression cannot pass as a clean tree', () => {
    expect(routes.filter((r) => hasRouteDecorator(r, 'PublicCacheable')).length).toBeGreaterThan(5);
  });

  it('canary: turns red on a @PublicCacheable route that is not @Public', () => {
    const file = {
      path: 'apps/api/src/modules/x/x.controller.ts',
      text: [
        "@Controller('v1')",
        'export class XController {',
        "  @Get('secrets')",
        '  @PublicCacheable(3600)',
        '  read() {}',
        '}',
      ].join(String.fromCharCode(10)),
    };
    const messages = checkPublicCacheable(readRoutes([file])).map((v) => v.message);
    expect(messages.some((m) => m.includes('not @Public()'))).toBe(true);
  });

  it('canary: turns red when the auth handler mounts after express.json', () => {
    const reordered = [
      'const app = await NestFactory.create(AppModule, { bodyParser: false });',
      'applyCacheControlHardening(app);',
      "app.use(express.json({ limit: '1mb' }));",
      "app.use('/v1/auth', toNodeHandler(auth));",
    ].join(String.fromCharCode(10));
    const messages = checkBootstrap(readRepoFile(HARDENING_MODULE), reordered).map(
      (v) => v.message,
    );
    expect(messages.some((m) => m.includes('mounts after express.json()'))).toBe(true);
  });

  it('canary: turns red when bodyParser is left on', () => {
    const messages = checkBootstrap(
      readRepoFile(HARDENING_MODULE),
      'applyCacheControlHardening(app);',
    ).map((v) => v.message);
    expect(messages.some((m) => m.includes('bodyParser: false'))).toBe(true);
  });

  it('canary: the guard turns red when the hardening is removed', () => {
    const stripped = 'export function applyCacheControlHardening() { /* nothing */ }';
    const messages = checkBootstrap(stripped, 'async function bootstrap() {}').map(
      (v) => v.message,
    );
    expect(messages.some((m) => m.includes("app.disable('etag') is absent"))).toBe(true);
    expect(messages.some((m) => m.includes('no-store'))).toBe(true);
    expect(messages.some((m) => m.includes('does not call applyCacheControlHardening'))).toBe(true);
  });

  it('canary: the guard turns red on a raw Cache-Control header', () => {
    const violations = checkRawHeaders(readCanary(GUARD));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('@PublicCacheable');
  });
});
