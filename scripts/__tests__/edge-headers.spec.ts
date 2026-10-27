/**
 * One emitter per security header. The admin container sets its set in
 * apps/admin/security-headers.conf, the API sets SECURITY_HEADERS from
 * libs/shared/common/src/middleware/security-headers.middleware.ts, and the
 * storefront's Nitro middleware sets its own. An edge vhost that adds the
 * same header again makes the browser and the installer's probe see two
 * values joined with a comma, and the probe refused a door that served every
 * header twice on the first real local install. The one exception is HSTS on
 * a host no application answers: the admin document (a static nginx emits
 * none), scoped to that location so the proxied API keeps its own, and the
 * storefront's www redirect.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

function addedHeaders(text: string): string[] {
  return [...text.matchAll(/^\s*add_header\s+([A-Za-z-]+)\s/gm)].map((m) => m[1].toLowerCase());
}

const read = (...segments: string[]) => fs.readFileSync(path.join(REPO, ...segments), 'utf8');

const ADMIN_CONTAINER = addedHeaders(read('apps', 'admin', 'security-headers.conf'));

/** The keys of the API's SECURITY_HEADERS object, read from its source. */
const API_APP = (() => {
  const source = read(
    'libs',
    'shared',
    'common',
    'src',
    'middleware',
    'security-headers.middleware.ts',
  );
  const literal =
    source.match(/export const SECURITY_HEADERS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
  return [...literal.matchAll(/^\s*'([A-Za-z-]+)':/gm)].map((m) => m[1].toLowerCase());
})();

/** The headers the storefront middleware sets, read from its source. */
const STOREFRONT_APP = (() => {
  const source = read('apps', 'storefront', 'src', 'server', 'middleware', 'security-headers.ts');
  return [
    ...source.matchAll(
      /'((?:X-[A-Za-z-]+|Referrer-Policy|Permissions-Policy|Content-Security-Policy|Strict-Transport-Security))'/g,
    ),
  ]
    .map((m) => m[1].toLowerCase())
    .filter((h, i, all) => all.indexOf(h) === i);
})();

describe('the application header sets this guard reads', () => {
  it('are non-empty and name the headers the installer probes for', () => {
    expect(ADMIN_CONTAINER).toEqual(
      expect.arrayContaining([
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy',
        'permissions-policy',
        'content-security-policy',
      ]),
    );
    expect(API_APP).toEqual(
      expect.arrayContaining([
        'strict-transport-security',
        'x-content-type-options',
        'referrer-policy',
      ]),
    );
    expect(STOREFRONT_APP).toEqual(
      expect.arrayContaining([
        'strict-transport-security',
        'x-content-type-options',
        'referrer-policy',
      ]),
    );
  });
});

/**
 * The rule: the headers a vhost adds that one of its applications already
 * emits, minus the named allowance, plus every allowance that is missing or
 * sits outside its block. Empty means the vhost is clean.
 */
function violations(text: string, upstream: string[], allowed: Record<string, string>): string[] {
  const edge = addedHeaders(text);
  const out = edge.filter((h) => upstream.includes(h) && !(h in allowed));
  for (const [header, block] of Object.entries(allowed)) {
    if (edge.filter((h) => h === header).length !== 1) out.push(`${header} not exactly once`);
    const start = text.indexOf(block);
    if (start < 0) {
      out.push(`${block.trim()} missing`);
      continue;
    }
    const end = text.indexOf('\n}', start);
    const scope = text.slice(start, end < 0 ? undefined : end);
    if (!addedHeaders(scope).includes(header)) out.push(`${header} outside ${block.trim()}`);
  }
  return out;
}

describe('the edge vhost templates', () => {
  // A template proxies to every application listed; the edge may add only
  // what none of them emits, plus the named allowance on the named location.
  it.each([
    [
      'admin.conf',
      [...ADMIN_CONTAINER, ...API_APP],
      { 'strict-transport-security': 'location / {' },
    ],
    ['local-admin.conf', [...ADMIN_CONTAINER, ...API_APP], {}],
    ['api.conf', API_APP, {}],
    ['storefront.conf', STOREFRONT_APP, { 'strict-transport-security': 'server_name www.' }],
  ] as [string, string[], Record<string, string>][])(
    '%s adds nothing its applications already emit',
    (template, upstream, allowed) => {
      const text = read('deploy', 'templates', 'nginx', template);
      expect(violations(text, upstream, allowed)).toEqual([]);
    },
  );

  it('the rule can fail: a planted duplicate and a misplaced allowance are both reported by the same check', () => {
    const planted =
      'server {\n    add_header X-Frame-Options "DENY" always;\n    add_header Strict-Transport-Security "max-age=1" always;\n    location / {\n        proxy_pass $admin;\n    }\n}\n';
    expect(
      violations(planted, ADMIN_CONTAINER, { 'strict-transport-security': 'location / {' }),
    ).toEqual(['x-frame-options', 'strict-transport-security outside location / {']);
    expect(violations(planted, [], {})).toEqual([]);
  });
});
