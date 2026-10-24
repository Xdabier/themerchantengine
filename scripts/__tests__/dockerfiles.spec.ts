/**
 * The image builds (plan E5.2). Every application image copies libs/ into its
 * build stage, and libs/shared/common imports @prisma/client, whose types
 * exist only after `prisma generate`. A build stage that runs `nx build`
 * without generating the client first compiles on a developer machine, where
 * the client was generated long ago, and fails inside Docker with
 * "Module '@prisma/client' has no exported member 'Prisma'". The first real
 * local install found the storefront image in that state.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const DOCKERFILES = ['api', 'admin', 'storefront'].map((app) =>
  path.join(REPO, 'apps', app, 'Dockerfile'),
);

function buildStageLines(dockerfile: string): string[] {
  // Lines from the first `FROM ... AS build` up to the next `FROM`.
  const lines = fs.readFileSync(dockerfile, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^FROM .* AS build\b/.test(l));
  if (start < 0) throw new Error(`${dockerfile}: no build stage`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^FROM /.test(l));
  return rest.slice(0, end < 0 ? rest.length : end);
}

describe.each(DOCKERFILES)('%s', (dockerfile) => {
  const stage = buildStageLines(dockerfile);
  const index = (pattern: RegExp) => stage.findIndex((l) => pattern.test(l));

  it('generates the Prisma client before building, because libs/shared/common imports it', () => {
    const build = index(/^RUN .*npx nx build /);
    const generate = index(/^RUN .*npx prisma generate\b/);
    expect(build, 'nx build').toBeGreaterThan(-1);
    expect(generate, 'prisma generate').toBeGreaterThan(-1);
    expect(generate).toBeLessThan(build);
  });

  it('builds on the Node major CI uses (.nvmrc)', () => {
    const major = fs
      .readFileSync(path.join(REPO, '.nvmrc'), 'utf8')
      .trim()
      .replace(/^v/, '')
      .split('.')[0];
    const text = fs.readFileSync(dockerfile, 'utf8');
    expect(text).toMatch(new RegExp(`^ARG NODE_VERSION=${major}-`, 'm'));
  });

  it('copies the schema and the Prisma config into the image before generating', () => {
    const text = fs.readFileSync(dockerfile, 'utf8');
    expect(text).toMatch(/^COPY .*\bprisma \.\/prisma\b/m);
    expect(text).toMatch(/^COPY .*\bprisma\.config\.ts\b/m);
  });
});

it('every stage that runs npm ci first copies the script the root prepare hook runs', () => {
  // `npm ci` runs the root `prepare` script. Without the file in the stage,
  // node exits 1 with MODULE_NOT_FOUND and the image build fails. The OS8
  // release rehearsal found every image in that state.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const script = /^node (\S+)$/.exec(pkg.scripts['prepare'] ?? '')?.[1];
  expect(script, 'prepare runs one node script').toBeDefined();
  for (const dockerfile of DOCKERFILES) {
    const lines = fs.readFileSync(dockerfile, 'utf8').split('\n');
    let copied = false;
    for (const line of lines) {
      if (/^FROM /.test(line)) copied = /^FROM (deps|build) /.test(line) && copied;
      if (/^COPY /.test(line) && line.includes(script as string)) copied = true;
      if (/^RUN npm ci\b/.test(line)) expect(copied, `${dockerfile}: ${line}`).toBe(true);
    }
  }
});

it('every package prisma/seed.ts loads at run time is a runtime dependency, because the API image installs with --omit=dev', () => {
  // The demo catalogue seed imports tsconfig-paths dynamically; as a dev
  // dependency it was absent from the runtime image and the first real local
  // install failed at the seed step with MODULE_NOT_FOUND.
  // The whole seed tree, not the entry file: a dynamic import added under
  // prisma/seeds/** reproduces the same failure.
  const seedFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) seedFiles.push(full);
    }
  };
  seedFiles.push(path.join(REPO, 'prisma', 'seed.ts'));
  walk(path.join(REPO, 'prisma', 'seeds'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const bare = seedFiles
    .flatMap((file) => [
      ...fs.readFileSync(file, 'utf8').matchAll(/(?:import|require)\(\s*'([^'./][^']*)'\s*\)/g),
    ])
    .map((m) => m[1])
    .filter((name) => !name.startsWith('node:'));
  expect(bare).toContain('tsconfig-paths');
  for (const name of bare) {
    expect(pkg.dependencies[name], `${name} must be in dependencies`).toBeDefined();
  }
});

it('the shared library still imports the Prisma client, or this guard has no reason to exist', () => {
  const money = fs.readFileSync(
    path.join(REPO, 'libs', 'shared', 'common', 'src', 'money', 'store-money.ts'),
    'utf8',
  );
  expect(money).toMatch(/from '@prisma\/client'/);
});
