/**
 * The pure parts of the storefront walkthrough: no network. The flow itself is
 * proven by running `npm run docs:walkthrough` against a live engine.
 */
import {
  CookieJar,
  compareRetry,
  formatJson,
  formatStep,
  parseArgs,
  redactSetCookie,
  summaryLine,
  type StepRecord,
} from '../storefront-walkthrough-lib';

describe('formatJson', () => {
  it('prints two-space JSON and trims a list longer than two items to two plus a "... n more" line', () => {
    expect(formatJson({ data: [1, 2, 3] })).toBe(
      '{\n  "data": [\n    1,\n    2\n    ... 1 more\n  ]\n}',
    );
    expect(formatJson({ data: [1, 2] })).toBe('{\n  "data": [\n    1,\n    2\n  ]\n}');
    expect(formatJson([])).toBe('[]');
    expect(formatJson({ nested: { list: ['a', 'b', 'c', 'd', 'e'] } })).toContain('... 3 more');
    expect(formatJson(null)).toBe('null');
  });
});

describe('formatStep', () => {
  const step: StepRecord = {
    method: 'POST',
    path: '/v1/cart/items',
    locale: 'fr',
    requestHeaders: {
      'Accept-Language': 'fr',
      'Content-Type': 'application/json',
      Cookie: 'sessionId=abc123; better-auth.session_token=tok',
    },
    requestBody: { variantId: 'v1', quantity: 1 },
    status: 200,
    responseHeaders: {
      'content-type': ['application/json; charset=utf-8'],
      'cache-control': ['no-store'],
      'x-request-id': ['req-1'],
      'set-cookie': ['sessionId=secret-value; Path=/; HttpOnly; SameSite=Strict'],
      date: ['ignored'],
    },
    body: { data: { items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] } },
  };

  it('prints the heading, the request, the status, the shown headers and the trimmed body', () => {
    const text = formatStep(step);
    expect(text.startsWith('### POST /v1/cart/items  [Accept-Language: fr]\n')).toBe(true);
    expect(text).toContain('> Accept-Language: fr');
    expect(text).toContain('"variantId": "v1"');
    expect(text).toContain('\nHTTP 200\n');
    expect(text).toContain('cache-control: no-store');
    expect(text).toContain('x-request-id: req-1');
    expect(text).toContain('... 1 more');
    expect(text).not.toContain('date: ignored');
  });

  it('redacts every set-cookie value and every request cookie value', () => {
    const text = formatStep(step);
    expect(text).toContain('set-cookie: sessionId=<redacted>; Path=/; HttpOnly; SameSite=Strict');
    expect(text).toContain('> Cookie: sessionId=<redacted>; better-auth.session_token=<redacted>');
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('abc123');
    expect(redactSetCookie('a=b')).toBe('a=<redacted>');
  });

  it('prints a note before the response and a non-JSON body as is', () => {
    const text = formatStep({ ...step, note: 'signed out', body: 'plain text' });
    expect(text).toContain('\nnote: signed out\n');
    expect(text.endsWith('plain text\n')).toBe(true);
  });
});

describe('CookieJar', () => {
  it('stores a Set-Cookie with attributes by name and replays the pairs', () => {
    const jar = new CookieJar();
    expect(jar.header()).toBeUndefined();
    jar.store(['sessionId=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000']);
    jar.store(['better-auth.session_token=tok.sig; Path=/; HttpOnly']);
    expect(jar.header()).toBe('sessionId=abc; better-auth.session_token=tok.sig');
    expect(jar.has('sessionId')).toBe(true);
  });

  it('overwrites a cookie by name and drops one the server clears', () => {
    const jar = new CookieJar();
    jar.store(['sessionId=one; Path=/']);
    jar.store(['sessionId=two; Path=/']);
    expect(jar.header()).toBe('sessionId=two');
    jar.store(['sessionId=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
    expect(jar.header()).toBeUndefined();
    jar.store(['a=1; Max-Age=0']);
    expect(jar.header()).toBeUndefined();
  });
});

describe('compareRetry', () => {
  it('passes on the same order id and fails on a different one or none', () => {
    expect(compareRetry({ data: { id: 'o1' } }, { data: { id: 'o1' } })).toEqual({
      same: true,
      line: 'retry: same order',
    });
    const different = compareRetry({ data: { id: 'o1' } }, { data: { id: 'o2' } });
    expect(different.same).toBe(false);
    expect(different.line).toBe('retry: DIFFERENT ORDER (o1 then o2)');
    expect(compareRetry({ data: { id: 'o1' } }, { error: {} }).same).toBe(false);
    expect(compareRetry(undefined, undefined).same).toBe(false);
  });
});

describe('parseArgs and the summary', () => {
  it('reads --base and --locales and defaults the rest', () => {
    expect(parseArgs([])).toEqual({
      base: 'http://localhost:53000/api',
      locales: [],
      origin: 'http://localhost:53300',
    });
    expect(
      parseArgs(['--base', 'http://x/api/', '--locales', 'en, fr', '--origin', 'http://shop/']),
    ).toEqual({ base: 'http://x/api', locales: ['en', 'fr'], origin: 'http://shop' });
    expect(() => parseArgs(['--what'])).toThrow(/unknown argument/);
  });

  it('prints the summary line', () => {
    expect(summaryLine(12, 0)).toBe('walkthrough: 12 requests, 0 failures');
  });
});
