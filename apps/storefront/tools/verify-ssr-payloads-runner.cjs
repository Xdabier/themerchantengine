/**
 * SH6 SSR-payload verifier runner.
 *
 * Driver script that:
 *   1. Spawns the production-build Nitro server
 *      (`node dist/apps/storefront/analog/server/index.mjs`) on
 *      port 53311 with PORT + NITRO_PORT env vars.
 *   2. Waits for the server's `Listening on` stdout marker.
 *   3. Invokes `verifyRouteSsrPayloads` from
 *      `verify-bundle-budgets.cjs` against each public route.
 *   4. Tears the server down regardless of verification outcome.
 *   5. Exits with the verifier's exit code.
 *
 * Wired as the `verify-ssr-payloads` Nx target
 * (apps/storefront/project.json). The Nx target's
 * `dependsOn: ["build"]` runs the production build first.
 *
 * Override the API base URL via `STOREFRONT_API_URL`; override the
 * verified route list via `STOREFRONT_SSR_VERIFY_ROUTES` (JSON array of
 * `{path, label}`); override the verified server base via
 * `STOREFRONT_SSR_VERIFY_BASE_URL` (defaults to http://localhost:53311).
 *
 * Local Windows note: the canonical fx-* slugs require the test API +
 * test seed which fail to spawn on this Windows host per
 * `specs/features/storefront-ssr-data-hydration/clarifications.md` §1.22.
 * Use `STOREFRONT_SSR_VERIFY_ROUTES` + `STOREFRONT_API_URL` to point at
 * the dev API + dev DB slugs when verifying locally.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  verifyRouteSsrPayloads,
  printSsrPayloadReport,
  readRoutesFromEnv,
  DEFAULT_SSR_ROUTES,
} = require('./verify-bundle-budgets.cjs');

const PORT = process.env['STOREFRONT_SSR_VERIFY_PORT'] ?? '53311';
const HOST = process.env['STOREFRONT_SSR_VERIFY_HOST'] ?? 'localhost';
const READY_PATTERN = /Listening on/;
const READY_TIMEOUT_MS = 60_000;

async function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const onChunk = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[ssr-server] ${text}`);
      if (READY_PATTERN.test(text)) {
        child.stdout.off('data', onChunk);
        resolve();
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', (chunk) => process.stderr.write(`[ssr-server-err] ${chunk}`));
    child.once('exit', (code, signal) => {
      reject(new Error(`Nitro server exited before ready (code=${code}, signal=${signal})`));
    });
    setTimeout(() => {
      child.stdout.off('data', onChunk);
      reject(new Error(`Nitro server did not emit ready pattern within ${READY_TIMEOUT_MS}ms`));
    }, READY_TIMEOUT_MS);
  });
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const serverEntry = path.join(workspaceRoot, 'dist', 'apps', 'storefront', 'analog', 'server', 'index.mjs');

  const env = {
    ...process.env,
    PORT,
    HOST,
    NITRO_PORT: PORT,
    NITRO_HOST: HOST,
  };

  process.stdout.write(`[verify-ssr-payloads] spawning ${serverEntry} on ${HOST}:${PORT}\n`);
  const child = spawn(process.execPath, [serverEntry], {
    cwd: workspaceRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exitCode = 0;
  try {
    await waitForReady(child);
    process.stdout.write('[verify-ssr-payloads] server ready, running verifier\n');
    const baseUrl = process.env['STOREFRONT_SSR_VERIFY_BASE_URL'] ?? `http://${HOST}:${PORT}`;
    const routes = readRoutesFromEnv() ?? DEFAULT_SSR_ROUTES;
    const result = await verifyRouteSsrPayloads({ baseUrl, routes });
    printSsrPayloadReport(baseUrl, result);
    if (!result.ok) exitCode = 1;
  } catch (err) {
    process.stderr.write(`[verify-ssr-payloads] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    exitCode = 2;
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM');
      // Allow the SIGTERM to land before exiting the parent.
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve();
        }, 3_000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(2);
});
