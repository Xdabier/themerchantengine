/**
 * The detector fingerprint, checked the way a detector reads a site: a local
 * server with the engine markers is detected, the canary server without them
 * is not, and the JSON patterns match the exact values the engine emits.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';

import {
  checkFingerprint,
  fetchPage,
  isDetected,
  loadFingerprint,
  patternRegex,
} from '../fingerprint-check';
import {
  ENGINE_FINGERPRINT_NAME,
  ENGINE_VERSION,
  engineFingerprintValue,
} from '../../libs/shared/common/src/fingerprint/engine-fingerprint';

const ROOT = path.resolve(__dirname, '..', '..');
const fingerprint = loadFingerprint();

const MARKED_HTML = `<!doctype html><html lang="en" data-tme-app="storefront"><head>
<meta name="generator" content="${ENGINE_FINGERPRINT_NAME}"></head><body></body></html>`;
const PLAIN_HTML = '<!doctype html><html lang="en"><head></head><body></body></html>';

async function serve(
  headers: Record<string, string>,
  html: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', ...headers });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('fingerprint:check', () => {
  it('detects a site that carries the engine markers', async () => {
    const site = await serve({ 'X-Powered-By': ENGINE_FINGERPRINT_NAME }, MARKED_HTML);
    try {
      const results = checkFingerprint(await fetchPage(site.url), fingerprint);
      expect(isDetected(results)).toBe(true);
      expect(results.filter((r) => r.matched).map((r) => r.rule)).toEqual([
        'header X-Powered-By',
        'meta generator',
        'dom html[data-tme-app]',
      ]);
    } finally {
      await site.close();
    }
  });

  it('canary: does not detect a site without the markers', async () => {
    const site = await serve({ 'X-Powered-By': 'Express' }, PLAIN_HTML);
    try {
      const results = checkFingerprint(await fetchPage(site.url), fingerprint);
      expect(isDetected(results)).toBe(false);
    } finally {
      await site.close();
    }
  });

  it('reports the js global as unchecked, never as a match', () => {
    const results = checkFingerprint({ headers: {}, html: MARKED_HTML }, fingerprint);
    expect(results.find((r) => r.rule === 'js themerchantengine')).toEqual({
      rule: 'js themerchantengine',
      matched: false,
      note: 'needs a browser, not checked',
    });
  });

  it('matches the default value and reads the version from the major form', () => {
    const name = engineFingerprintValue({});
    const major = engineFingerprintValue({ TME_FINGERPRINT_VERSION: 'major' });
    expect(name).toBe(ENGINE_FINGERPRINT_NAME);
    expect(major).toBe(`${ENGINE_FINGERPRINT_NAME} ${ENGINE_VERSION.split('.')[0]}`);

    for (const pattern of [
      fingerprint.meta!['generator']!,
      fingerprint.headers!['X-Powered-By']!,
    ]) {
      expect(patternRegex(pattern).exec(name!)).not.toBeNull();
      expect(patternRegex(pattern).exec(major!)?.[1]).toBe(ENGINE_VERSION.split('.')[0]);
      expect(patternRegex(pattern).test('Express')).toBe(false);
    }
  });

  it('matches the markers in the real storefront and admin index.html', () => {
    for (const file of ['apps/storefront/index.html', 'apps/admin/src/index.html']) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const matched = checkFingerprint({ headers: {}, html }, fingerprint)
        .filter((r) => r.matched)
        .map((r) => r.rule);
      expect(matched, file).toEqual(['meta generator', 'dom html[data-tme-app]']);
    }
  });
});
