import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REPO_ROOT,
  expectNoViolations,
  readRepoFile,
  readTree,
  matchAll,
  SourceFile,
  Violation,
} from './lib/repo';

/**
 * Constitution 3.7: env vars only, never a literal credential in the tree.
 *
 * This is the one rule from the retired `post-edit.sh` that ESLint cannot take
 * over: it applies to every file type, not only the ones a TypeScript parser
 * reads. It runs in `npm run gate` and in the pre-commit path instead.
 */
const GUARD = 'secrets';

// Wider than the deleted hook's per-edit scan, on purpose. Prose directories
// such as `deploy/` and `docs/` are exactly where a credential gets pasted.
const SCANNED_DIRS = [
  'apps',
  'libs',
  'scripts',
  'prisma',
  'tools/setup',
  'docker',
  'docs',
  'specs',
  'agent_docs',
  'deploy',
  'ci',
  'prod-verify',
  'test',
  '.github',
  '.claude',
];

/** Lockfiles and build output carry base64 blobs no human wrote. */
const SKIP = /(?:^|\/)(?:package-lock\.json|.*\.snap|.*\.min\.js|.*\.map)$/;

/** Mirrors the one `[allowlist] paths` entry in `.gitleaks.toml`, anchored on
 * the exact filename the way that file is. A test below asserts the two lists
 * stay equal, so a hole opened in one shows up as a failure in the other. */
const ALLOWLIST = [/(^|\/)test\/fixtures\/license\/private\.pem$/];

const PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: 'an AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'a live Stripe secret key', pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'a GitHub personal access token', pattern: /\bghp_[0-9a-zA-Z]{30,}\b/ },
  {
    name: 'an inline AWS secret access key',
    pattern: /AWS_SECRET_ACCESS_KEY\s*[:=]\s*['"][^'"\n]{8,}['"]/,
  },
  { name: 'private key material', pattern: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/ },
];

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (SKIP.test(file.path)) continue;
    if (ALLOWLIST.some((allowed) => allowed.test(file.path))) continue;
    for (const { name, pattern } of PATTERNS) {
      violations.push(
        ...matchAll(
          file,
          pattern,
          () => `${name} in the tree. Secrets come from the environment (constitution 3.7).`,
        ),
      );
    }
  }
  return violations;
}

/**
 * The canary is assembled at run time rather than committed as a fixture.
 *
 * A file of credential-shaped bytes in the tree collides with the gitleaks job
 * in CI, which scans the whole working tree and the reachable history under a
 * one-filename allowlist. The only ways to make that job green again are a
 * `.gitleaksignore` fingerprint or a wider allowlist path, and both punch a
 * hole in the strongest secret control this repository has. So the canary never
 * exists on disk, and the source does not contain the byte sequences either,
 * because each value is concatenated from parts.
 */
function canaryFiles(): SourceFile[] {
  const fake = [
    `AWS_ACCESS_KEY_ID=${'AKIA'}${'Q'.repeat(16)}`,
    `STRIPE_KEY=${'sk_'}${'live_'}${'0'.repeat(24)}`,
    `GITHUB_TOKEN=${'ghp_'}${'0'.repeat(30)}`,
    `AWS_SECRET_ACCESS_KEY="${'z'.repeat(20)}"`,
    `${'-----BEGIN'} RSA ${'PRIVATE KEY-----'}`,
    'not-a-real-key',
  ].join('\n');
  return [{ path: 'apps/api/src/leaked.env', text: `${fake}\n` }];
}

describe(GUARD, () => {
  it('finds no credential material in the tracked source trees', () => {
    // tools/guards is excluded from its own scan: this file states the
    // patterns it looks for, so scanning it would report itself.
    expectNoViolations(
      check(readTree({ dirs: SCANNED_DIRS, exclude: (p) => p.startsWith('tools/guards/') })),
    );
  });

  it('canary: the guard turns red on every credential shape it knows', () => {
    const messages = check(canaryFiles()).map((v) => v.message);
    for (const { name } of PATTERNS) {
      expect(messages.some((m) => m.includes(name))).toBe(true);
    }
  });

  it('allowlists exactly what .gitleaks.toml allowlists, and nothing more', () => {
    // The two lists are compared by what they match, not by their source text,
    // because one is a TOML regex and the other a JavaScript one. A path
    // allowed by gitleaks and not here is noise; a path allowed here and not
    // by gitleaks is a hole this guard would open on its own.
    const declared = [...readRepoFile('.gitleaks.toml').matchAll(/'''(.*?)'''/g)].map(
      (m) => new RegExp(m[1]),
    );
    expect(declared).toHaveLength(ALLOWLIST.length);
    for (const list of [declared, ALLOWLIST]) {
      expect(list.some((r) => r.test('test/fixtures/license/private.pem'))).toBe(true);
      expect(list.some((r) => r.test('deploy/private.pem'))).toBe(false);
    }
  });

  it('canary: a key like the allowlisted one would otherwise be reported', () => {
    const pem = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(pem).not.toBe('');
    expect(check([{ path: 'somewhere/else/private.pem', text: pem }])).toHaveLength(1);
  });

  it('keeps no credential-shaped fixture on disk, so the CI secret scan stays exact', () => {
    // readTree deliberately hides the canary tree from every scan, so this one
    // walks it directly. A fixture here would be invisible to the guard and
    // very visible to gitleaks.
    const root = join(REPO_ROOT, 'tools/guards/src/__fixtures__');
    const files: SourceFile[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push({ path: full.split('\\').join('/'), text: readFileSync(full, 'utf8') });
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    expectNoViolations(check(files));
  });
});
