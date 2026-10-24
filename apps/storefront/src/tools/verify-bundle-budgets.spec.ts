/**
 * Vitest spec for tools/verify-bundle-budgets.cjs (S14.4).
 *
 * Drives the bundle-budget verifier against fixture manifests + fixture
 * chunk files written into a temp dir per test. The real
 * `dist/apps/storefront/client` is exercised by the e2e gate at S14.12.
 *
 * Lives under src/tools/ so apps/storefront/tsconfig.spec.json (include:
 * src/**\/*.spec.ts) picks it up; the verifier itself stays under
 * apps/storefront/tools/ since it is a build-time Node script.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import {
  verifyBundleBudgets,
  verifyRouteSsrPayloads,
  readRoutesFromEnv,
  FIRST_LOAD_CAP_BYTES,
  IDLE_HYDRATION_CAP_BYTES,
  SSR_PAYLOAD_SOFT_CAP_BYTES,
  SSR_PAYLOAD_HARD_CAP_BYTES,
  DEFAULT_SSR_ROUTES,
  // @ts-expect-error — CJS module without .d.ts; runtime contract verified via the assertions below.
} from '../../tools/verify-bundle-budgets.cjs';

interface ManifestEntry {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

function writeFixture(
  tmpDir: string,
  manifest: Record<string, ManifestEntry>,
  chunkContents: Record<string, string>,
): { manifestPath: string; chunkDir: string } {
  const viteDir = path.join(tmpDir, '.vite');
  fs.mkdirSync(viteDir, { recursive: true });
  const manifestPath = path.join(viteDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  for (const [file, contents] of Object.entries(chunkContents)) {
    const fullPath = path.join(tmpDir, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return { manifestPath, chunkDir: tmpDir };
}

/**
 * Build a payload of approximately `targetGzBytes` after gzip. Truly
 * random bytes (`crypto.randomBytes`) compress almost 1:1, so the raw
 * length needed is `targetGzBytes + ~30 bytes` of gzip overhead. This
 * is O(n) and avoids the O(n²) re-gzip loop the earlier implementation
 * used (vitest hung on it under jsdom env).
 */
function payloadForGzSize(targetGzBytes: number): string {
  return crypto.randomBytes(targetGzBytes).toString('binary');
}

describe('verifyBundleBudgets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-budget-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exposes the documented budget thresholds', () => {
    expect(FIRST_LOAD_CAP_BYTES).toBe(170 * 1024);
    expect(IDLE_HYDRATION_CAP_BYTES).toBe(60 * 1024);
  });

  it('returns ok=true when all chunks are under budget', () => {
    const { manifestPath, chunkDir } = writeFixture(
      tmpDir,
      {
        'src/main.ts': {
          file: 'assets/entry.js',
          isEntry: true,
          imports: ['_vendor.js'],
          dynamicImports: ['src/lazy.ts'],
        },
        '_vendor.js': { file: 'assets/vendor.js' },
        'src/lazy.ts': { file: 'assets/lazy.js' },
      },
      {
        'assets/entry.js': payloadForGzSize(20 * 1024),
        'assets/vendor.js': payloadForGzSize(40 * 1024),
        'assets/lazy.js': payloadForGzSize(30 * 1024),
      },
    );
    const { ok, table } = verifyBundleBudgets({ manifestPath, chunkDir });
    expect(ok).toBe(true);
    expect(table.find((r: { chunk: string }) => r.chunk === '<first-load total>')).toBeDefined();
  });

  it('flags first-load total over the 170 KB cap', () => {
    const { manifestPath, chunkDir } = writeFixture(
      tmpDir,
      {
        'src/main.ts': { file: 'assets/entry.js', isEntry: true, imports: ['_vendor.js'] },
        '_vendor.js': { file: 'assets/vendor.js' },
      },
      {
        'assets/entry.js': payloadForGzSize(100 * 1024),
        'assets/vendor.js': payloadForGzSize(100 * 1024),
      },
    );
    const { ok, table } = verifyBundleBudgets({ manifestPath, chunkDir });
    expect(ok).toBe(false);
    const total = table.find((r: { chunk: string }) => r.chunk === '<first-load total>');
    expect(total?.over).toBe(true);
  });

  it('flags an idle chunk over the 60 KB cap', () => {
    const { manifestPath, chunkDir } = writeFixture(
      tmpDir,
      {
        'src/main.ts': {
          file: 'assets/entry.js',
          isEntry: true,
          dynamicImports: ['src/heavy.ts'],
        },
        'src/heavy.ts': { file: 'assets/heavy.js' },
      },
      {
        'assets/entry.js': payloadForGzSize(20 * 1024),
        'assets/heavy.js': payloadForGzSize(70 * 1024),
      },
    );
    const { ok, table } = verifyBundleBudgets({ manifestPath, chunkDir });
    expect(ok).toBe(false);
    const heavy = table.find((r: { chunk: string }) => r.chunk === 'assets/heavy.js');
    expect(heavy?.over).toBe(true);
    expect(heavy?.role).toBe('idle');
  });

  it('throws MANIFEST_MISSING when the manifest is absent', () => {
    expect(() =>
      verifyBundleBudgets({
        manifestPath: path.join(tmpDir, 'does-not-exist.json'),
        chunkDir: tmpDir,
      }),
    ).toThrow(/manifest not found/i);
  });

  it('respects custom budget caps passed by the caller', () => {
    const { manifestPath, chunkDir } = writeFixture(
      tmpDir,
      {
        'src/main.ts': { file: 'assets/entry.js', isEntry: true },
      },
      {
        'assets/entry.js': payloadForGzSize(20 * 1024),
      },
    );
    const { ok } = verifyBundleBudgets({
      manifestPath,
      chunkDir,
      firstLoadCapBytes: 10 * 1024,
      idleCapBytes: 5 * 1024,
    });
    expect(ok).toBe(false);
  });
});

/**
 * SH6 — verifyRouteSsrPayloads.
 *
 * Drives the SSR HTML payload verifier with a synthetic `fetchImpl` that
 * returns Buffers of controlled gzipped size, exercising the soft-cap
 * warn / hard-cap fail / fetch-error / argument-validation paths
 * without spawning a real HTTP server.
 */

interface FakeRoute {
  path: string;
  rawBytes: number;
  status?: number;
  throwError?: string;
}

function makeFakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  return (async (url: string) => {
    const target = new URL(url);
    const pathKey = target.pathname + (target.search ?? '');
    const route = routes[pathKey];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    if (route.throwError) throw new Error(route.throwError);
    const body = crypto.randomBytes(route.rawBytes);
    return new Response(new Uint8Array(body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }) as unknown as typeof fetch;
}

describe('verifyRouteSsrPayloads', () => {
  it('exposes soft + hard caps and the canonical route list', () => {
    expect(SSR_PAYLOAD_SOFT_CAP_BYTES).toBe(25 * 1024);
    expect(SSR_PAYLOAD_HARD_CAP_BYTES).toBe(50 * 1024);
    expect(DEFAULT_SSR_ROUTES).toHaveLength(7);
    expect((DEFAULT_SSR_ROUTES as Array<{ label?: string }>).map((r) => r.label)).toEqual([
      'home',
      'catalog',
      'category',
      'product',
      'search',
      'about',
      'policy',
    ]);
  });

  it('returns ok=true when every route is under the soft cap', async () => {
    const fakeFetch = makeFakeFetch({
      '/fr/': { path: '/fr/', rawBytes: 10 * 1024 },
      '/fr/about': { path: '/fr/about', rawBytes: 5 * 1024 },
    });
    const { ok, table } = await verifyRouteSsrPayloads({
      baseUrl: 'http://localhost:53311',
      routes: [
        { path: '/fr/', label: 'home' },
        { path: '/fr/about', label: 'about' },
      ],
      fetchImpl: fakeFetch,
    });
    expect(ok).toBe(true);
    expect(table).toHaveLength(2);
    expect(table.every((r: { soft: boolean; hard: boolean }) => !r.soft && !r.hard)).toBe(true);
  });

  it('flags soft-cap warn but stays ok=true when payload is between 25 and 50 KB gz', async () => {
    // Random bytes are near-incompressible; ~40 KB raw → ~40 KB gz.
    const fakeFetch = makeFakeFetch({
      '/fr/': { path: '/fr/', rawBytes: 40 * 1024 },
    });
    const { ok, table } = await verifyRouteSsrPayloads({
      baseUrl: 'http://localhost:53311',
      routes: [{ path: '/fr/', label: 'home' }],
      fetchImpl: fakeFetch,
    });
    expect(ok).toBe(true);
    expect(table[0].soft).toBe(true);
    expect(table[0].hard).toBe(false);
    expect(table[0].gzBytes).toBeGreaterThan(SSR_PAYLOAD_SOFT_CAP_BYTES);
    expect(table[0].gzBytes).toBeLessThan(SSR_PAYLOAD_HARD_CAP_BYTES);
  });

  it('returns ok=false when any payload exceeds the hard cap', async () => {
    const fakeFetch = makeFakeFetch({
      '/fr/': { path: '/fr/', rawBytes: 60 * 1024 },
      '/fr/about': { path: '/fr/about', rawBytes: 5 * 1024 },
    });
    const { ok, table } = await verifyRouteSsrPayloads({
      baseUrl: 'http://localhost:53311',
      routes: [
        { path: '/fr/', label: 'home' },
        { path: '/fr/about', label: 'about' },
      ],
      fetchImpl: fakeFetch,
    });
    expect(ok).toBe(false);
    const homeRow = table.find((r: { route: string }) => r.route === 'home');
    expect(homeRow?.hard).toBe(true);
    const aboutRow = table.find((r: { route: string }) => r.route === 'about');
    expect(aboutRow?.hard).toBe(false);
  });

  it('returns ok=false and records the error message when fetch rejects', async () => {
    const fakeFetch = makeFakeFetch({
      '/fr/': { path: '/fr/', rawBytes: 0, throwError: 'ECONNREFUSED 127.0.0.1:53311' },
    });
    const { ok, table } = await verifyRouteSsrPayloads({
      baseUrl: 'http://localhost:53311',
      routes: [{ path: '/fr/', label: 'home' }],
      fetchImpl: fakeFetch,
    });
    expect(ok).toBe(false);
    expect(table[0].error).toContain('ECONNREFUSED');
    expect(table[0].status).toBe(0);
    expect(table[0].gzBytes).toBe(0);
  });

  it('strips the trailing slash from baseUrl before joining the route path', async () => {
    let observedUrl = '';
    const fakeFetch = (async (url: string) => {
      observedUrl = url;
      return new Response(new Uint8Array(Buffer.from('hi')), { status: 200 });
    }) as unknown as typeof fetch;
    await verifyRouteSsrPayloads({
      baseUrl: 'http://localhost:53311/',
      routes: [{ path: '/fr/', label: 'home' }],
      fetchImpl: fakeFetch,
    });
    expect(observedUrl).toBe('http://localhost:53311/fr/');
  });

  it('respects custom soft + hard caps passed by the caller', async () => {
    const fakeFetch = makeFakeFetch({
      '/fr/': { path: '/fr/', rawBytes: 1024 },
    });
    const { ok, table } = await verifyRouteSsrPayloads({
      baseUrl: 'http://localhost:53311',
      routes: [{ path: '/fr/', label: 'home' }],
      softCapBytes: 100,
      hardCapBytes: 500,
      fetchImpl: fakeFetch,
    });
    expect(ok).toBe(false);
    expect(table[0].hard).toBe(true);
    expect(table[0].soft).toBe(true);
  });

  it('throws when baseUrl is missing', async () => {
    await expect(
      verifyRouteSsrPayloads({
        baseUrl: '',
        routes: [{ path: '/fr/', label: 'home' }],
        fetchImpl: makeFakeFetch({}),
      }),
    ).rejects.toThrow(/baseUrl is required/);
  });

  it('throws when routes is empty', async () => {
    await expect(
      verifyRouteSsrPayloads({
        baseUrl: 'http://localhost:53311',
        routes: [],
        fetchImpl: makeFakeFetch({}),
      }),
    ).rejects.toThrow(/routes is required/);
  });

  it('proves zlib encodes random bytes near 1:1 — sanity check for the soft-cap test fixtures', () => {
    const raw = crypto.randomBytes(40 * 1024);
    const gz = zlib.gzipSync(raw, { level: 9 }).byteLength;
    expect(gz).toBeGreaterThan(35 * 1024);
    expect(gz).toBeLessThan(45 * 1024);
  });
});

describe('readRoutesFromEnv', () => {
  const ORIGINAL = process.env['STOREFRONT_SSR_VERIFY_ROUTES'];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['STOREFRONT_SSR_VERIFY_ROUTES'];
    else process.env['STOREFRONT_SSR_VERIFY_ROUTES'] = ORIGINAL;
  });

  it('returns undefined when env var is unset', () => {
    delete process.env['STOREFRONT_SSR_VERIFY_ROUTES'];
    expect(readRoutesFromEnv()).toBeUndefined();
  });

  it('parses a JSON array of {path, label}', () => {
    process.env['STOREFRONT_SSR_VERIFY_ROUTES'] = JSON.stringify([
      { path: '/fr/', label: 'home' },
      { path: '/fr/about' },
    ]);
    const routes = readRoutesFromEnv();
    expect(routes).toEqual([
      { path: '/fr/', label: 'home' },
      { path: '/fr/about', label: undefined },
    ]);
  });

  it('throws on malformed JSON', () => {
    process.env['STOREFRONT_SSR_VERIFY_ROUTES'] = '{not-json';
    expect(() => readRoutesFromEnv()).toThrow(/JSON parse failed/);
  });

  it('throws when the parsed value is not an array', () => {
    process.env['STOREFRONT_SSR_VERIFY_ROUTES'] = '{"path":"/fr/"}';
    expect(() => readRoutesFromEnv()).toThrow(/must be a JSON array/);
  });
});
