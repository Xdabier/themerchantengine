import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDevelopment, isProduction, isTest, runtimeEnvironment } from './runtime-environment';

describe('runtimeEnvironment', () => {
  it.each([['development'], ['test']])('honours the allow-listed label %s', (label) => {
    expect(runtimeEnvironment({ NODE_ENV: label })).toBe(label);
  });

  it.each([
    ['production'],
    ['prod'],
    ['staging'],
    ['Production'],
    ['PRODUCTION'],
    [''],
    [undefined],
  ])('reads NODE_ENV=%s as production', (label) => {
    expect(runtimeEnvironment({ NODE_ENV: label })).toBe('production');
    expect(isProduction({ NODE_ENV: label })).toBe(true);
    expect(isDevelopment({ NODE_ENV: label })).toBe(false);
    expect(isTest({ NODE_ENV: label })).toBe(false);
  });

  it('reads a missing key as production', () => {
    expect(runtimeEnvironment({})).toBe('production');
  });

  it('reads through a ConfigService-shaped source', () => {
    const config = { get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined) };
    expect(runtimeEnvironment(config)).toBe('test');
    expect(isTest(config)).toBe(true);
    expect(runtimeEnvironment({ get: () => 'staging' })).toBe('production');
    expect(runtimeEnvironment({ get: () => undefined })).toBe('production');
  });

  it('defaults to process.env', () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(true);
      process.env.NODE_ENV = 'staging';
      expect(isProduction()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});

/**
 * Source guard: no runtime file outside this module may compare `NODE_ENV`
 * against a label itself. A literal comparison is a deny-list on one string,
 * which is the defect class this predicate closes; a new one is a question
 * the author has to answer here, not a site the guard walks past.
 */
describe('NODE_ENV is read only through the shared predicate', () => {
  const root = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const scanned = ['apps/api/src', 'apps/storefront/src', 'libs/shared/common/src', 'prisma'];
  const allowed = new Set([
    'libs/shared/common/src/env/runtime-environment.ts',
    // Reports the raw label on the health endpoint; decides nothing on it.
    'apps/api/src/health/health.controller.ts',
    // Tags Sentry events with the raw label; decides nothing on it.
    'apps/api/src/sentry/sentry.ts',
    'libs/shared/common/src/sentry/sentry.ts',
  ]);
  // Binding the raw label to a local, which a later comparison on the local
  // would hide from the pattern below.
  const binding =
    /(?:const|let|var)\s+\w+\s*=\s*(?:process\.env\.NODE_ENV|process\.env\['NODE_ENV'\]|[\w.]+\.get(?:<[^>]*>)?\('NODE_ENV'[^)]*\))/;
  // A comparison of NODE_ENV against any string literal, in either order.
  const comparison =
    /NODE_ENV['"\])]*\s*[!=]==?\s*['"`]|['"`][A-Za-z]+['"`]\s*[!=]==?\s*(?:process\.env\.|env\[?['"]?)NODE_ENV/;

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'migrations') continue;
        yield* sourceFiles(full);
      } else if (/\.(ts|js|mjs|cjs)$/.test(entry.name) && !/\.spec\.[tj]s$/.test(entry.name)) {
        yield full;
      }
    }
  }

  it('finds no literal NODE_ENV comparison outside the predicate', () => {
    const offenders: string[] = [];
    for (const dir of scanned) {
      for (const file of sourceFiles(path.join(root, dir))) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (allowed.has(relative)) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
          if (comparison.test(line) || binding.test(line)) {
            offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would catch a literal comparison', () => {
    // The canary: every shape the sweep replaced must still match the pattern,
    // or the guard above is decorative.
    const shapes = [
      "process.env.NODE_ENV === 'production'",
      "process.env.NODE_ENV !== 'production'",
      "env['NODE_ENV'] === 'production'",
      "env.NODE_ENV !== 'production'",
      "this.config.get<string>('NODE_ENV') === 'production'",
      "'production' === process.env.NODE_ENV",
      "env === 'test' || env === 'development'",
    ];
    // The last shape reads a local named `env`, which the comparison pattern
    // cannot see; the binding pattern closes that door by refusing the line
    // that creates such a local from the raw label.
    expect(shapes.slice(0, -1).every((shape) => comparison.test(shape))).toBe(true);
    expect(comparison.test(shapes[shapes.length - 1])).toBe(false);
    for (const bound of [
      'const env = process.env.NODE_ENV;',
      "let env = process.env['NODE_ENV'];",
      "const env = this.config.get<string>('NODE_ENV');",
      "const env = this.configService.get<string>('NODE_ENV', 'development');",
    ]) {
      // Jest has no message argument; the shape rides in the compared string.
      expect(`${bound} -> ${binding.test(bound)}`).toBe(`${bound} -> true`);
    }
    expect(binding.test('const env = runtimeEnvironment();')).toBe(false);
  });
});
