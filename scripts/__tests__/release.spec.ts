/**
 * The release script (plan E5.3), driven against a scratch git repository
 * whose `build:setup` writes a stub bundle. The tarball must carry the
 * wrappers and the bundle and nothing untracked, the bundle must be newer
 * than every source so the wrapper does not rebuild, and each refusal must
 * name what to do.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const RELEASE = path.join(REPO, 'scripts', 'release.mjs');

function scratchRepo(version = '9.9.9'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-release-spec-'));
  const write = (relative: string, content: string) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write(
    'package.json',
    JSON.stringify(
      {
        name: 'themerchantengine',
        version,
        scripts: {
          'build:setup':
            "node -e \"require('fs').mkdirSync('tools/setup/dist',{recursive:true});require('fs').writeFileSync('tools/setup/dist/index.js','console.log(1)')\"",
        },
      },
      null,
      2,
    ),
  );
  write('CHANGELOG.md', `# themerchantengine\n\n## ${version}\n\n- the entry\n`);
  write('setup.sh', '#!/usr/bin/env bash\necho wrapper\n');
  write('setup.ps1', 'Write-Host wrapper\n');
  write('tools/setup/src/index.ts', 'export {};\n');
  write('tools/setup/build.mjs', '// stub\n');
  write('.gitignore', '.env*\n.setup-state.json\nnode_modules/\ntools/setup/dist/\ndist/\n');
  write('.env.production', 'SECRET=never-in-a-tarball\n');
  write('.setup-state.json', '{}\n');
  write('node_modules/left/over.js', '// never\n');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.email', 'spec@example.test');
  git('config', 'user.name', 'spec');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return dir;
}

function release(cwd: string, ...args: string[]) {
  return spawnSync('node', [RELEASE, ...args], { cwd, encoding: 'utf8' });
}

/** Relative paths under a cwd: the tar on Windows reads a drive letter as a remote host. */
function tarList(tarball: string): string[] {
  return execFileSync('tar', ['-tzf', path.basename(tarball)], {
    cwd: path.dirname(tarball),
    encoding: 'utf8',
  })
    .split('\n')
    .map((l) => l.trim().replace(/^\.\//, ''))
    .filter(Boolean)
    .sort();
}

describe('npm run release', () => {
  let dir: string;
  beforeEach(() => {
    dir = scratchRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('archives HEAD plus a bundle newer than every source, and tags', () => {
    const result = release(dir, '--out', 'out');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const tarball = path.join(dir, 'out', 'themerchantengine-v9.9.9.tar.gz');
    expect(fs.existsSync(tarball)).toBe(true);
    const listed = tarList(tarball).filter((f) => !f.endsWith('/'));
    expect(listed).toEqual(
      expect.arrayContaining([
        'setup.sh',
        'setup.ps1',
        'tools/setup/dist/index.js',
        'tools/setup/src/index.ts',
        'package.json',
        'CHANGELOG.md',
      ]),
    );
    expect(
      listed.some(
        (f) =>
          f.startsWith('.env') || f.includes('node_modules') || f.endsWith('.setup-state.json'),
      ),
    ).toBe(false);

    const extracted = path.join(dir, 'extracted');
    fs.mkdirSync(extracted);
    execFileSync('tar', ['-xzf', path.join('out', path.basename(tarball)), '-C', 'extracted'], {
      cwd: dir,
    });
    // The wrapper's own staleness rule, lifted from setup.sh and run against
    // the extracted tree: a stale bundle would make ./setup.sh build, which a
    // tarball user cannot do without the workspace install.
    const wrapper = fs.readFileSync(path.join(REPO, 'setup.sh'), 'utf8');
    const staleFn = wrapper.match(/^stale\(\) \{[\s\S]*?^\}/m)?.[0];
    expect(staleFn, 'setup.sh declares stale()').toBeDefined();
    fs.mkdirSync(path.join(extracted, 'libs', 'shared', 'common', 'src'), { recursive: true });
    const verdict = spawnSync(
      'bash',
      [
        '-c',
        `BUNDLE=tools/setup/dist/index.js; ${staleFn}; if stale; then echo stale; else echo fresh; fi`,
      ],
      { cwd: extracted, encoding: 'utf8' },
    );
    expect(verdict.stdout.trim()).toBe('fresh');
    // And the rule can fail: touch a source newer than the bundle.
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(extracted, 'tools', 'setup', 'src', 'index.ts'), future, future);
    const again = spawnSync(
      'bash',
      [
        '-c',
        `BUNDLE=tools/setup/dist/index.js; ${staleFn}; if stale; then echo stale; else echo fresh; fi`,
      ],
      { cwd: extracted, encoding: 'utf8' },
    );
    expect(again.stdout.trim()).toBe('stale');

    const tags = execFileSync('git', ['tag', '--list'], { cwd: dir, encoding: 'utf8' }).trim();
    expect(tags).toBe('v9.9.9');
    expect(result.stdout).toContain('git push origin v9.9.9');
  });

  it('writes nothing on a dry run and skips the tag on --no-tag', () => {
    const dry = release(dir, '--dry-run', '--out', 'out');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('nothing written');
    expect(fs.existsSync(path.join(dir, 'out'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'tools', 'setup', 'dist'))).toBe(false);

    const untagged = release(dir, '--no-tag', '--out', 'out');
    expect(untagged.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'out', 'themerchantengine-v9.9.9.tar.gz'))).toBe(true);
    expect(execFileSync('git', ['tag', '--list'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('');
  });

  it('archives LF line endings whatever the core.autocrlf of the release machine', () => {
    execFileSync('git', ['config', 'core.autocrlf', 'true'], { cwd: dir });
    const result = release(dir, '--no-tag', '--out', 'out');
    expect(result.status).toBe(0);
    const extracted = path.join(dir, 'extracted');
    fs.mkdirSync(extracted);
    execFileSync(
      'tar',
      ['-xzf', path.join('out', 'themerchantengine-v9.9.9.tar.gz'), '-C', 'extracted'],
      { cwd: dir },
    );
    for (const file of ['package.json', 'setup.sh', 'tools/setup/src/index.ts']) {
      expect(fs.readFileSync(path.join(extracted, file), 'utf8'), file).not.toContain('\r');
    }
  });

  it('refuses a dirty tree and says what to do', () => {
    fs.writeFileSync(path.join(dir, 'setup.sh'), '#!/usr/bin/env bash\necho edited\n');
    const result = release(dir, '--dry-run');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not clean/);
    expect(result.stderr).toMatch(/Commit or stash/);
  });

  it('refuses a changelog whose first section is not the version, even when the version appears further down', () => {
    fs.writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      '# themerchantengine\n\n## Unreleased\n\n- the new entry\n\n## 9.9.9\n\n- older\n',
    );
    execFileSync('git', ['commit', '-qam', 'leave the entry untitled'], { cwd: dir });
    const result = release(dir, '--dry-run');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/first section is "## Unreleased", not "## 9\.9\.9"/);
    expect(result.stderr).toMatch(/Title the entry/);
  });

  it('refuses a tag that already exists', () => {
    execFileSync('git', ['tag', 'v9.9.9'], { cwd: dir });
    const result = release(dir, '--dry-run');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/v9\.9\.9 already exists/);
  });

  it('refuses to run anywhere but the repository root', () => {
    const nested = path.join(dir, 'tools');
    const result = release(nested, '--dry-run');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/repository root/);
  });
});

it('the real archive leaves the planning record, the audits, the agent docs, the research notes and the fixture key behind, and no shipped spec reads them', () => {
  // The release script archives HEAD. This archives the staged tree, which is
  // HEAD once committed and in CI, so the pre-commit hook already reads the
  // .gitattributes the commit will carry.
  const tree = execFileSync('git', ['write-tree'], { cwd: REPO, encoding: 'utf8' }).trim();
  const listing = execFileSync('git', ['archive', '--format=tar', tree], {
    cwd: REPO,
    maxBuffer: 256 * 1024 * 1024,
  });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-archive-'));
  try {
    fs.writeFileSync(path.join(scratch, 'head.tar'), listing);
    const entries = execFileSync('tar', ['-tf', 'head.tar'], {
      cwd: scratch,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean);
    // The planning record, the audits, the two clients' QA records, the
    // studio's brand book, the client-reference guard (whose token table
    // names the clients), the fixture private key, the agent instructions,
    // the gitleaks fingerprint list, the research and marketing notes, a
    // third-party PDF, and the specs that read the agent tooling or the token
    // table, which would fail in the tarball without them.
    const forbidden =
      /^(specs|\.claude|\.session-runner|docs\/audit|agent_docs|docs\/marketing)\/|^(CLAUDE|SCAFFOLD_SUMMARY)\.md$|^\.gitleaksignore$|^docs\/The Anatomy of a High-Converting Landing Page.*\.pdf$|^docs\/(CMS-ERP-Ecommerce-Research-EXPANDED|LLM-Driven-Development-Research-Report|organic-acquisition-research-2026|storefront-research)\.md$|^docs\/security-(audit-report|research)\.md$|^docs\/(admin|storefront)-manual-qa-findings.*\.md$|^docs\/badii-studio-brand-guidelines\.md$|^scripts\/verify-no-client-refs\.tokens\.json$|^scripts\/__tests__\/(verify-no-client-refs|active-phase|commit-guard|pre-commit|run-phases)\.spec\.ts$|^tools\/guards\/src\/(config-protection|git-hooks|skills-metadata|coverage-thresholds|nx-affected)\.spec\.ts$|^tools\/setup\/src\/(bundle|render\/template)\.spec\.ts$|^test\/fixtures\/license\/private\.pem$/;
    expect(entries.filter((e) => forbidden.test(e))).toEqual([]);
    for (const kept of [
      'setup.sh',
      'setup.ps1',
      'tools/setup/build.mjs',
      'deploy/templates/compose.local.yml',
      'test/fixtures/license/public.pem',
      'prisma/schema.prisma',
      // Placeholder identity only, and the shipped CI workflow reads it.
      'ci/answers.local.json',
      // Same directory names deeper in the tree: the ignore list is anchored.
      'scripts/ci/render-nginx-templates.mjs',
      'apps/admin-services-e2e/src/specs/auth.spec.ts',
    ]) {
      expect(entries, kept).toContain(kept);
    }
    // A shipped spec that reads a path the archive leaves behind fails in the
    // licensee's tree. The guard module loads the ignored token table on import.
    // A spec may read the table itself only behind a skipIf on its presence.
    const readsIgnored =
      /\b(?:REPO|REPO_ROOT|ROOT),\s*['`](?:\.claude|specs|agent_docs|\.session-runner|CLAUDE\.md)\b|\b(?:readRepoFile|readTree)\(\s*(?:\{\s*dirs:\s*\[\s*)?(?:join\(\s*)?['`](?:\.claude|specs|agent_docs|\.session-runner|CLAUDE\.md)\b|\/scripts\/verify-no-client-refs['"]/;
    const readsTable = /['`]verify-no-client-refs\.tokens\.json['`]/;
    const guardsTable = /\.skipIf\(\s*!existsSync\(/;
    const readers = entries
      .filter((e) => /\.(e2e-)?spec\.ts$/.test(e))
      .filter((e) => {
        const source = fs.readFileSync(path.join(REPO, e), 'utf8');
        return readsIgnored.test(source) || (readsTable.test(source) && !guardsTable.test(source));
      });
    expect(readers).toEqual([]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

it('is wired as npm run release and the tarball directory is ignored', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  expect(pkg.scripts.release).toBe('node scripts/release.mjs');
  const ignored = spawnSync('git', ['check-ignore', 'dist/release/x.tar.gz'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  expect(ignored.status).toBe(0);
});

it('keeps the private registry and CI runner notes out of the image build files', () => {
  for (const file of [
    'apps/api/Dockerfile',
    'apps/admin/Dockerfile',
    'apps/storefront/Dockerfile',
    '.dockerignore',
  ]) {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8');
    expect(text, file).not.toMatch(/gitlab|dind|engine box/i);
  }
});

it('keeps the hosting provider notes and personal paths out of the shipped tree', () => {
  // Assembled from parts so this shipped spec does not carry the tokens itself.
  const forbidden = new RegExp(
    [
      ['ov', 'h'],
      ['xda', 'bi'],
    ]
      .map((p) => p.join(''))
      .join('|'),
    'i',
  );
  for (const file of [
    '.gitignore',
    '.dockerignore',
    'apps/api/src/modules/assets/storage/s3-storage.driver.ts',
    'apps/api/src/modules/assets/storage/storage.module.ts',
    'apps/api/src/modules/seo/seo.service.ts',
    'scripts/llm-metrics/lint-instructions.mjs',
    'scripts/__tests__/typecheck-batch.spec.ts',
  ]) {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8');
    expect(text, file).not.toMatch(forbidden);
  }
});

it('ignores the private upload directories the API writes in dev and test', () => {
  for (const file of ['uploads-private/x.pdf', 'uploads-test-private/x.pdf']) {
    const ignored = spawnSync('git', ['check-ignore', file], { cwd: REPO, encoding: 'utf8' });
    expect(ignored.status, file).toBe(0);
  }
});

it('tracks no license private key, the fixture script discards it', () => {
  const tracked = execFileSync('git', ['ls-files', 'test/fixtures/license/private.pem'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  expect(tracked.trim()).toBe('');
  const script = fs.readFileSync(
    path.join(REPO, 'scripts/license/make-fixture-keypair.ts'),
    'utf8',
  );
  expect(script).not.toMatch(/private\.pem/);
});
