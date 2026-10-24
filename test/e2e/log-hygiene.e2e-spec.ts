/**
 * Log hygiene — no personal data from a query string reaches an API log line
 * (plan J Phase J6, pass-2 finding K10, constitution §3.7).
 *
 * `GET /v1/orders/:orderNumber/track?email=` used to take the customer email as
 * the ownership challenge. The pino request serializer logs `req.url` verbatim,
 * so before plan J the address landed in every log line for that request and in
 * any reverse-proxy access log in front of it.
 *
 * Plan M phase M3 then REMOVED that route, and the probe below is more useful
 * for it: an unmatched URL is exactly the request nobody wrote a handler to
 * guard, and it is what a bot or a typo produces. It also found a second leak
 * the serializer alone did not close. Nest's own route-not-found message is
 * `Cannot GET <the raw url>`, and the exception filter logged
 * `exception.message` verbatim beside an already-redacted `path`, so the
 * address went into the log in clear between two clean fields. Both the message
 * and the url are redacted now.
 *
 * This reads the real log the e2e API writes rather than stubbing a
 * destination: the out-of-process harness boots a webpack-bundled API whose
 * stdout and stderr go to `test/.e2e-api.log`, so the file IS the production
 * code path's output. Moving the challenge into a POST body is plan M's work;
 * this rule holds whichever endpoints exist.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { api } from './helpers';

const API_LOG = path.resolve(__dirname, '..', '.e2e-api.log');
const RUN = crypto.randomUUID().slice(0, 8);
const PROBE_ORDER = `ORD-J6-${RUN}`;
const PROBE_EMAIL = `probe-${RUN}@example.com`;
/** Supertest percent-encodes the query, so the leak lands in this form. */
const PROBE_EMAIL_ENCODED = encodeURIComponent(PROBE_EMAIL);
/** The local part alone is still personal data, and survives any encoding. */
const PROBE_LOCAL_PART = `probe-${RUN}`;

/**
 * Log lines written after `offset` bytes, parsed where they are pino JSON.
 *
 * `offset` comes from `fs.statSync(...).size`, a BYTE count. Reading the file
 * as a `utf8` string first and then `.slice`-ing it by that byte count is
 * wrong whenever a multi-byte character (Arabic script under the gulf-rtl
 * fixture, or an accented Latin letter) appears before the cut point: the
 * string's character index no longer lines up with the file's byte index, so
 * the slice lands short or long and can miss the very line under test. Slice
 * the raw `Buffer` by byte offset first, decode only the tail.
 */
function linesSince(offset: number): string[] {
  const raw = fs.readFileSync(API_LOG).subarray(offset).toString('utf8');
  return raw.split('\n').filter((line) => line.trim().length > 0);
}

describe('Log hygiene — query-string personal data (K10)', () => {
  it('never writes the tracked email into a log line, and still logs the request', async () => {
    if (!fs.existsSync(API_LOG)) {
      throw new Error(
        `${API_LOG} not found. The e2e harness reuses an API already healthy on the port, ` +
          'and a reused instance writes no log here, so this spec cannot verify. ' +
          'Kill the stale API and re-run.',
      );
    }
    const offset = fs.statSync(API_LOG).size;

    // A deliberately unknown order number: the 404 path logs the same request
    // line, and the spec must not depend on seeded order data.
    await api().get(`/v1/orders/${PROBE_ORDER}/track`).query({ email: PROBE_EMAIL }).expect(404);

    // The bundled API writes through a file descriptor; poll rather than a
    // single fixed wait, since the flush time varies with how much the rest
    // of the run has already written to the same file.
    let written: string[] = [];
    let trackLines: string[] = [];
    for (let i = 0; i < 20 && trackLines.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      written = linesSince(offset);
      trackLines = written.filter((line) => line.includes(PROBE_ORDER));
    }
    if (trackLines.length === 0) {
      // A reused API writes nothing here, so an empty log is "cannot verify",
      // never "verified clean". Fail loudly rather than pass vacuously.
      throw new Error(
        `no log line for ${PROBE_ORDER} was written to ${API_LOG}; ` +
          'the harness may have reused a stale API instance on the port',
      );
    }

    // The positive half: the line is still useful for debugging.
    const parsed = trackLines
      .map((line) => {
        try {
          return JSON.parse(line) as {
            req?: { method?: string; url?: string; requestId?: string };
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { req: { method: string; url: string; requestId: string } } =>
        Boolean(entry?.req?.url),
      );
    expect(parsed.length).toBeGreaterThan(0);
    for (const entry of parsed) {
      expect(entry.req.method).toBe('GET');
      expect(entry.req.url).toContain(`/v1/orders/${PROBE_ORDER}/track`);
      expect(entry.req.requestId).toEqual(expect.any(String));
      expect(entry.req.requestId.length).toBeGreaterThan(0);
      expect(entry.req.url).not.toContain('@');
      expect(entry.req.url).not.toContain('%40');
      expect(entry.req.url).not.toContain(PROBE_LOCAL_PART);
    }

    // The negative half, over every line the request produced, not just the
    // request line: an error log or a handler log must not carry it either.
    // The exception filter logs its own `path` field, which was a second leak
    // the request serializer alone did not close.
    for (const line of written) {
      expect(line).not.toContain(PROBE_EMAIL);
      expect(line).not.toContain(PROBE_EMAIL_ENCODED);
      expect(line).not.toContain(PROBE_LOCAL_PART);
    }
  });

  // The whole-file sweep, not just this spec's own request. Every other e2e in
  // the suite drives the API through the same log, so a route that puts an
  // address in a query string anywhere shows up here. `%40` is what a
  // percent-encoded `@` looks like on the wire.
  it('leaves no encoded email address in any url or path field of the run', () => {
    const lines = linesSince(0);

    const offenders: string[] = [];
    for (const line of lines) {
      for (const match of line.matchAll(/"(?:url|path)":"([^"]*)"/g)) {
        const value = match[1];
        if (value.includes('%40') || value.includes('@')) offenders.push(value);
      }
    }

    expect(offenders).toEqual([]);
  });
});
