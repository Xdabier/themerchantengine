/**
 * The onboarding docs a stranger reads first (plan OS7). The public tree is
 * what `git archive` produces, so a link into an export-ignored path is a
 * dead link for every reader of the published repository. The README once
 * promised a postinstall hook that does not exist and named env vars the
 * code never reads; the commercial license pointed at a contact that was
 * "not yet published".
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(REPO, relative), 'utf8');
const CONTACT = 'badii@badii.studio';

const COMMUNITY_FILES = [
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/dependabot.yml',
];

const PUBLIC_DOCS = [
  'README.md',
  'CHANGELOG.md',
  'COMMERCIAL-LICENSE.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

function exportIgnored(relative: string): boolean {
  // A directory pattern such as `/specs/` only matches the directory itself,
  // so every ancestor is asked with a trailing slash.
  const parts = relative.split('/');
  const queries = [
    relative,
    ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/') + '/'),
  ];
  const out = execFileSync('git', ['check-attr', 'export-ignore', '--', ...queries], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return /: export-ignore: set$/m.test(out);
}

function relativeLinks(doc: string): string[] {
  const text = read(doc).replace(/```[\s\S]*?```/g, '');
  return [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1])
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split('#')[0]);
}

it.each(COMMUNITY_FILES)('%s exists', (file) => {
  expect(fs.existsSync(path.join(REPO, file))).toBe(true);
});

describe.each(PUBLIC_DOCS)('%s', (doc) => {
  const present = fs.existsSync(path.join(REPO, doc));

  it('links only to files the public tree carries', () => {
    if (!present) return;
    for (const target of relativeLinks(doc)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(doc), target));
      expect(fs.existsSync(path.join(REPO, resolved)), `${doc} -> ${target} exists`).toBe(true);
      expect(
        exportIgnored(resolved.replace(/\/$/, '')),
        `${doc} -> ${target} is export-ignored`,
      ).toBe(false);
    }
  });

  it('carries no contact placeholder and no em-dash', () => {
    if (!present) return;
    const text = read(doc);
    expect(text).not.toMatch(/not yet published|draft for operator review|TBD|<your[- ]email>/i);
    expect(text).not.toContain('—');
  });
});

it('the link check sees an export-ignored path, or it proves nothing', () => {
  expect(exportIgnored('specs/constitution.md')).toBe(true);
  expect(exportIgnored('CLAUDE.md')).toBe(true);
  expect(exportIgnored('docs/site/index.md')).toBe(false);
});

it.each(['README.md', 'COMMERCIAL-LICENSE.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'])(
  '%s names the contact address',
  (doc) => {
    expect(read(doc)).toContain(CONTACT);
  },
);

it('the first CHANGELOG section is the package version, as `npm run release` requires', () => {
  const version = (JSON.parse(read('package.json')) as { version: string }).version;
  const first = read('CHANGELOG.md')
    .match(/^## (.+)$/m)?.[1]
    ?.trim();
  expect(first).toBe(version);
});

it('package.json names the author, the repository, the issue tracker and the homepage', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
  expect(pkg['author']).toBe('Badii Studio');
  expect(JSON.stringify(pkg['repository'])).toContain('github.com/Xdabier/themerchantengine');
  expect(JSON.stringify(pkg['bugs'])).toContain('github.com/Xdabier/themerchantengine/issues');
  expect(typeof pkg['homepage']).toBe('string');
});

describe('README', () => {
  const readme = read('README.md');

  it('promises no postinstall hook and names no env var the code never reads', () => {
    expect(readme).not.toMatch(/postinstall/i);
    for (const stale of ['SENDGRID', 'AWS_S3_BUCKET', 'AWS_ACCESS_KEY', 'STRIPE_SECRET_KEY']) {
      expect(readme, stale).not.toContain(stale);
    }
    for (const real of ['RESEND_API_KEY', 'S3_BUCKET', 'STRIPE_API_KEY']) {
      expect(readme, real).toContain(real);
    }
  });

  it('states the Tailwind version package.json installs', () => {
    const range = (JSON.parse(read('package.json')) as { devDependencies: Record<string, string> })
      .devDependencies['tailwindcss'];
    const [major, minor] = range.replace(/^[^\d]*/, '').split('.');
    expect(readme).toContain(`Tailwind ${major}.${minor}`);
    expect(readme).not.toMatch(/Tailwind v?(?!3\b)\d/);
  });

  it('lists the mail and shipping adapters as planned', () => {
    expect(readme).toMatch(/planned/i);
    expect(readme).toMatch(/shipping/i);
  });
});

it('.env.example sets the API prefix the admin and storefront dev proxies forward to', () => {
  expect(read('.env.example')).toMatch(/^API_GLOBAL_PREFIX=api$/m);
});

it('the README keeps the four-origin CORS default from .env.example', () => {
  expect(read('README.md')).not.toMatch(/^\s*CORS_ORIGIN=http:\/\/localhost:53200\s*$/m);
});

it('.env.example names every env var the API, the storefront and the shared libs read', () => {
  const sources = ['apps/api/src', 'apps/storefront/src', 'libs/shared/common/src'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ts$/.test(entry.name) && !/\.(e2e-)?spec\.ts$/.test(entry.name)) files.push(full);
    }
  };
  sources.forEach((dir) => walk(path.join(REPO, dir)));
  const names = new Set<string>();
  const pattern =
    /process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[['"]([A-Z_][A-Z0-9_]*)['"]\])|import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(pattern))
      names.add(m[1] ?? m[2] ?? m[3]);
  }
  // Commented-out OAuth providers, and legacy fallbacks the current names win over.
  const excluded = new Set([
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'APPLE_CLIENT_ID',
    'APPLE_CLIENT_SECRET',
    'CORS_ORIGINS',
    'SITE_URL',
    'API_URL',
  ]);
  expect(names.size).toBeGreaterThan(40);
  const example = read('.env.example');
  const missing = [...names]
    .filter((name) => !excluded.has(name))
    .filter((name) => !new RegExp(`^#?\\s*${name}=`, 'm').test(example));
  expect(missing).toEqual([]);
});
