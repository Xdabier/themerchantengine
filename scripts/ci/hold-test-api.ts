/**
 * Boots the e2e API the way the backend e2e suite does (schema push, search
 * index, seed, cache flush, the API on :53001 with no global prefix) and then
 * keeps the process alive so another step can run against it.
 *
 * The storefront SSR smoke needs a seeded API and boots none of its own; the
 * backend e2e suite's globalSetup is the one place that shape is defined, so
 * this reuses it rather than restating it.
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register -P tsconfig.base.json scripts/ci/hold-test-api.ts
 *
 * Prints `hold-test-api: ready` once the API answers. Stop it with SIGTERM.
 */
import globalSetup from '../../test/e2e-global-setup';

async function main(): Promise<void> {
  // The SSR smoke was written against the storefront harness's seed, which
  // plants the fixture catalogue and its SeoRedirect rows on top of the
  // baseline; the backend suite's seed plants the baseline alone. Same two
  // switches scripts/seed-storefront-test.ts sets.
  process.env['FIXTURE_CATALOGUE_SEED'] ??= '1';
  process.env['SEED_UPLOADS_ROOT'] ??= 'uploads-test';
  // The API it boots must serve the images that seed wrote.
  process.env['UPLOADS_ROOT'] ??= process.env['SEED_UPLOADS_ROOT'];
  process.env['PRIVATE_UPLOADS_DIR'] ??= 'uploads-test-private';
  process.env['UPLOADS_BASE_URL'] ??= 'http://localhost:53001/uploads';
  await globalSetup();
  process.stdout.write('hold-test-api: ready\n');
  const child = (globalThis as Record<string, unknown>).__E2E_API__ as
    | { kill: () => void }
    | undefined;
  const stop = () => {
    child?.kill();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  setInterval(() => undefined, 1 << 30);
}

main().catch((err) => {
  process.stderr.write(`hold-test-api: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
