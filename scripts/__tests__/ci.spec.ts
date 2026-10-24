/**
 * The generic pipeline (plan E5.2): the workflow names every gate the plan
 * asks for, every command it runs exists in this tree, and the nginx render
 * it depends on is strict in both directions.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import { COMPOSE, EDGES, render, renderAll } from '../ci/render-nginx-templates.mjs';
// Relative on purpose: the stepper is its own package with no workspace alias.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CI_SMOKE_OWNER_PASSWORD } from '../../tools/setup/src/steps/owner';

/**
 * A first-party GitHub action may float on a major tag; anything else must be
 * pinned to a commit, and an image that is handed the repository must be
 * pinned by digest. A mutable tag on a third-party action is the vector the
 * tj-actions/changed-files compromise used.
 */
export function actionPinned(use: string): boolean {
  const [name, ref] = use.split('@');
  if (!ref) return false;
  if (name.startsWith('actions/')) return /^v\d+$/.test(ref);
  return /^[0-9a-f]{40}$/.test(ref);
}
export function imagePinned(image: string): boolean {
  return /@sha256:[0-9a-f]{64}$/.test(image);
}

const REPO = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'ci.yml');

interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  'runs-on': string;
  'timeout-minutes'?: number;
  steps: Step[];
}
interface Workflow {
  on: unknown;
  jobs: Record<string, Job>;
}

const workflow = yaml.load(fs.readFileSync(WORKFLOW, 'utf8')) as Workflow;
const scripts = (
  JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

describe('the workflow', () => {
  it('runs on every push and every pull request', () => {
    expect(workflow.on).toEqual({ push: null, pull_request: null });
  });

  it('names every gate the plan asks for and no other pipeline exists', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(
      [
        'admin-e2e',
        'backend-e2e',
        'build',
        'docs-generate-check',
        'install-smoke',
        'lint',
        'nginx-templates',
        'secret-scan',
        'setup-standalone',
        'ssr-smoke',
        'storefront-e2e',
        'unit',
        'verify-no-client-refs',
      ].sort(),
    );
    expect(fs.readdirSync(path.join(REPO, '.github', 'workflows'))).toEqual(['ci.yml']);
    expect(fs.existsSync(path.join(REPO, '.gitlab-ci.yml'))).toBe(false);
  });

  it('gives every job a timeout, because the runner default is six hours', () => {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      expect(job['timeout-minutes'], id).toBeGreaterThan(0);
    }
  });

  const runLines = Object.entries(workflow.jobs).flatMap(([id, job]) =>
    job.steps
      .filter((s) => typeof s.run === 'string')
      .flatMap((s) => (s.run as string).split('\n').map((line) => ({ id, line: line.trim() }))),
  );

  it('only runs npm scripts that package.json declares', () => {
    const invoked = runLines.flatMap(({ id, line }) =>
      [...line.matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => ({ id, script: m[1] })),
    );
    expect(invoked.length).toBeGreaterThanOrEqual(4);
    for (const { id, script } of invoked) {
      expect(scripts[script], `${id} runs npm run ${script}`).toBeDefined();
    }
  });

  it('only runs repository files that exist', () => {
    const files = runLines.flatMap(({ id, line }) =>
      [...line.matchAll(/(?:^|[\s/])((?:scripts|tools|ci)\/[A-Za-z0-9_./-]+|\.\/setup\.sh)/g)].map(
        (m) => ({
          id,
          file: m[1].replace(/^\.\//, ''),
        }),
      ),
    );
    expect(files.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        'tools/setup/verify-standalone.mjs',
        'scripts/ci/render-nginx-templates.mjs',
        'scripts/ci/nginx-test.sh',
        'scripts/ci/hold-test-api.ts',
        'ci/answers.local.json',
        'setup.sh',
      ]),
    );
    for (const { id, file } of files) {
      expect(fs.existsSync(path.join(REPO, file)), `${id} names ${file}`).toBe(true);
    }
  });

  it('pins every image by digest and every third-party action by commit', () => {
    const images = runLines.flatMap(({ line }) =>
      [...line.matchAll(/docker run [^\n]*?\s([a-z0-9./-]+:[A-Za-z0-9.@:-]+)\s/g)].map((m) => m[1]),
    );
    const envImages = Object.values(workflow.jobs).flatMap((job) =>
      Object.values((job as unknown as { env?: Record<string, string> }).env ?? {}).filter((v) =>
        /^[a-z0-9./-]+:v?[0-9]/.test(v),
      ),
    );
    expect(images.length + envImages.length).toBeGreaterThan(1);
    for (const image of [...images, ...envImages]) expect(imagePinned(image), image).toBe(true);
    const uses = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.map((s) => s.uses).filter((u): u is string => Boolean(u)),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(actionPinned(use), use).toBe(true);
  });

  it('the pin rule can fail: a third-party action on a tag and an image on a tag are refused', () => {
    expect(actionPinned('actions/checkout@v4')).toBe(true);
    expect(actionPinned('tj-actions/changed-files@v45')).toBe(false);
    expect(actionPinned('tj-actions/changed-files@' + 'a'.repeat(40))).toBe(true);
    expect(actionPinned('actions/checkout')).toBe(false);
    expect(imagePinned('nginx:1.27-alpine')).toBe(false);
    expect(imagePinned('nginx:1.27-alpine@sha256:' + 'b'.repeat(64))).toBe(true);
  });

  it('runs the installer twice in the smoke job, on the committed CI answers', () => {
    const smoke = workflow.jobs['install-smoke'].steps.map((s) => s.run ?? '').join('\n');
    const runs =
      smoke.match(/\.\/setup\.sh --profile local --answers ci\/answers\.local\.json/g) ?? [];
    expect(runs).toHaveLength(2);
    expect(smoke).not.toMatch(/npm ci/);
    expect(smoke).toMatch(/down -v/);
  });

  it('lints every project: `lint` where a project declares it, `eslint:lint` for exactly the rest', () => {
    const show = (target: string): string[] =>
      JSON.parse(
        execFileSync('npx', ['nx', 'show', 'projects', '--withTarget', target, '--json'], {
          cwd: REPO,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        }),
      ) as string[];
    const withLint = new Set(show('lint'));
    const inferredOnly = show('eslint:lint')
      .filter((p) => !withLint.has(p))
      .sort();
    expect(inferredOnly.length).toBeGreaterThan(0);
    const lint = workflow.jobs['lint'].steps.map((s) => s.run ?? '').join('\n');
    expect(lint).toMatch(/npx nx run-many -t lint --parallel=1\n/);
    const projects = lint.match(/-t eslint:lint --parallel=1 --projects=([a-z0-9,-]+)/)?.[1];
    expect(projects, 'the eslint:lint step names its projects').toBeDefined();
    expect((projects as string).split(',').sort()).toEqual(inferredOnly);
  });

  it('parses the local edge without the base conf it never mounts', () => {
    const steps = workflow.jobs['nginx-templates'].steps as (Step & { name?: string })[];
    const local = steps.find((s) => /local edge/i.test(s.name ?? ''));
    expect(local?.run).toMatch(/-e BASE_CONF=\/dev\/null .*\/rendered\/local/);
    const server = steps.find((s) => /server edge/i.test(s.name ?? ''));
    expect(server?.run).not.toMatch(/BASE_CONF/);
  });

  it('canaries the secret scanner before trusting it', () => {
    const steps = workflow.jobs['secret-scan'].steps as (Step & { name?: string })[];
    const canary = steps.findIndex((s) => /planted key/i.test(s.name ?? ''));
    const scan = steps.findIndex((s) => /scan the tree/i.test(s.name ?? ''));
    expect(canary).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(canary);
    expect(steps[canary].run).toMatch(/exit 1/);
    expect(steps[canary].run).toMatch(/test\/fixtures\/license\/other\.pem/);
    expect(
      steps.some(
        (s) =>
          /history/i.test(s.name ?? '') &&
          /gitleaks|GITLEAKS_IMAGE/.test(s.run ?? '') &&
          / git \/repo/.test(s.run ?? ''),
      ),
      'history leg',
    ).toBe(true);
    expect((workflow as unknown as { permissions?: Record<string, string> }).permissions).toEqual({
      contents: 'read',
    });
    expect(steps[scan].run).toMatch(/--config \/repo\/\.gitleaks\.toml/);
  });
});

describe('the CI answers document', () => {
  it('is the local example with placeholder identity and credentials', () => {
    const ci = JSON.parse(fs.readFileSync(path.join(REPO, 'ci', 'answers.local.json'), 'utf8'));
    const example = JSON.parse(
      fs.readFileSync(path.join(REPO, 'tools', 'setup', 'answers.local.example.json'), 'utf8'),
    );
    expect(Object.keys(ci).sort()).toEqual(Object.keys(example).sort());
    expect(ci.profile).toBe('local');
    expect(ci.owner.email).toMatch(/@ci\.example$/);
    // The stepper refuses this exact value on every profile but local.
    expect(ci.owner.password).toBe(CI_SMOKE_OWNER_PASSWORD);
    expect(JSON.stringify(ci)).not.toMatch(/atlas\.example|Replace_With/);
  });
});

describe('the nginx template render', () => {
  it('writes both edges and every compose profile with no placeholder left', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-render-'));
    try {
      const written = renderAll(scratch);
      expect(
        written.map((f) => path.relative(scratch, f).split(path.sep).join('/')).sort(),
      ).toEqual([
        'compose/both/docker-compose.yml',
        'compose/engine/docker-compose.yml',
        'compose/local/docker-compose.yml',
        'compose/storefront/docker-compose.yml',
        'local/10-admin.conf',
        'local/10-storefront.conf',
        'server/00-http.conf',
        'server/10-admin.conf',
        'server/10-api.conf',
        'server/10-storefront.conf',
      ]);
      for (const file of written) expect(fs.readFileSync(file, 'utf8')).not.toMatch(/\{\{/);
      expect(Object.keys(COMPOSE).sort()).toEqual(['both', 'engine', 'local', 'storefront']);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('the CI render rule is the stepper renderer rule, so a placeholder cannot drift between them', () => {
    const stepper = fs.readFileSync(
      path.join(REPO, 'tools', 'setup', 'src', 'render', 'template.ts'),
      'utf8',
    );
    const ci = fs.readFileSync(
      path.join(REPO, 'scripts', 'ci', 'render-nginx-templates.mjs'),
      'utf8',
    );
    const rule = (src: string) => src.match(/const PLACEHOLDER = (\/.+\/g);/)?.[1];
    expect(rule(ci)).toBeDefined();
    expect(rule(ci)).toBe(rule(stepper));
  });

  it('refuses a template that CI has no render entry for', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-render-canary-'));
    const templates = path.join(scratch, 'templates');
    fs.cpSync(path.join(REPO, 'deploy', 'templates'), templates, { recursive: true });
    fs.writeFileSync(
      path.join(templates, 'nginx', 'mail.conf'),
      'server { server_name {{HOST}}; }\n',
    );
    try {
      expect(() => renderAll(path.join(scratch, 'out'), templates)).toThrow(/mail\.conf/);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('is strict in both directions, like the stepper renderer', () => {
    expect(() => render('a {{HOST}} b', {}, 't')).toThrow(/no value for \{\{HOST\}\}/);
    expect(() => render('a b', { HOST: 'x' }, 't')).toThrow(/never used/);
    expect(render('a {{HOST}} b', { HOST: 'x' }, 't')).toBe('a x b');
    expect(Object.keys(EDGES)).toEqual(['server', 'local']);
  });
});

/** The job ids a body of prose names in backticks. */
function jobsNamedIn(page: string, jobs: string[]): string[] {
  return jobs.filter((job) => page.includes(`\`${job}\``));
}

describe('the public testing page', () => {
  const page = fs.readFileSync(
    path.join(REPO, 'docs', 'site', 'customize', 'testing-and-gates.md'),
    'utf8',
  );
  const jobs = Object.keys(workflow.jobs);

  it('names every job of the workflow, so a new gate cannot ship undocumented', () => {
    expect(jobsNamedIn(page, jobs).sort()).toEqual([...jobs].sort());
  });

  it('the rule fires on a page that drops a job', () => {
    const without = page.replace('`docs-generate-check`', '`docs-generate-chk`');
    expect(jobsNamedIn(without, jobs)).not.toContain('docs-generate-check');
    expect(jobsNamedIn(without, jobs)).toHaveLength(jobs.length - 1);
  });
});
