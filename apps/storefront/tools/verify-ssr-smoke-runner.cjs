/**
 * Local driver for the production-build SSR smoke gate.
 *
 * Boots the real Nitro output (`dist/apps/storefront/analog/server/index.mjs`,
 * produced by `nx build storefront --configuration=production`. The Nx target
 * depends on `build`, so it is already fresh when this runs), points it at the
 * test API, waits for it to listen, runs `verify-ssr-smoke.cjs` against it, and
 * tears it down whatever the outcome.
 *
 * The production server is the whole point. `nx serve storefront` resolves page
 * loaders over plain HTTP and keeps the request url intact; the production build
 * resolves them over an internal `$fetch` that drops the query. Only this
 * process reaches the second branch, so only this gate can see the class of
 * defect that shipped in `0c9801a8`.
 *
 * Mirrors `verify-ssr-payloads-runner.cjs`: same spawn, same ready marker, same
 * teardown. Port 53311 is the storefront e2e port from `CLAUDE.md`.
 *
 * Env:
 *   STOREFRONT_API_URL         API base, prefix included. Default
 *                              http://localhost:53001/api (the test API the
 *                              storefront e2e harness spawns).
 *   STOREFRONT_SMOKE_PORT      port to boot on   (default 53311)
 *   STOREFRONT_SMOKE_HOST      host to bind      (default localhost)
 *   plus everything `verify-ssr-smoke.cjs` reads.
 *
 * Exit codes are the verifier's: 0 pass · 1 a page rendered wrong · 2 the
 * fixture or the harness could not produce a meaningful comparison.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { verifySsrSmoke } = require('./verify-ssr-smoke.cjs');

const PORT = process.env['STOREFRONT_SMOKE_PORT'] ?? '53311';
const HOST = process.env['STOREFRONT_SMOKE_HOST'] ?? 'localhost';
const API_URL = process.env['STOREFRONT_API_URL'] ?? 'http://localhost:53001/api';
const READY_PATTERN = /Listening on/;
const READY_TIMEOUT_MS = 60_000;

function portInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net
      .connect({ host, port: Number(port) })
      .once('connect', () => {
        socket.destroy();
        resolve(true);
      })
      .once('error', () => resolve(false));
    socket.setTimeout(2_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForReady(child) {
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

async function stop(child) {
  if (child.killed) return;
  child.kill('SIGTERM');
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

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const serverEntry = path.join(
    workspaceRoot,
    'dist',
    'apps',
    'storefront',
    'analog',
    'server',
    'index.mjs',
  );

  // The Nx target builds first (`dependsOn: ["build"]`), so this only bites a
  // direct `node apps/storefront/tools/verify-ssr-smoke-runner.cjs`. Say what is
  // missing rather than letting the spawn fail as "exited before ready".
  if (!fs.existsSync(serverEntry)) {
    process.stderr.write(
      `[ssr-smoke] no production build at ${serverEntry}\n` +
        '  Run the gate through its Nx target, which builds first:\n' +
        '    npm run test:storefront-ssr-smoke\n',
    );
    process.exit(2);
  }

  // 53311 is the storefront e2e port and four other harnesses claim it:
  // `serve-production`, `verify-ssr-payloads-runner.cjs`, the storefront-e2e dev
  // server and LHCI. A listener already there answers the readiness check and
  // then serves someone else's build, so say so instead of reporting whatever it
  // renders as this build's behaviour.
  if (await portInUse(HOST, PORT)) {
    process.stderr.write(
      `[ssr-smoke] something is already listening on ${HOST}:${PORT}\n` +
        '  That is the storefront e2e port, shared with serve-production, verify-ssr-payloads\n' +
        '  and LHCI. Stop it, or move this run with STOREFRONT_SMOKE_PORT.\n',
    );
    process.exit(2);
  }

  process.stdout.write(`[ssr-smoke] spawning ${serverEntry} on ${HOST}:${PORT}\n`);
  const child = spawn(process.execPath, [serverEntry], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PORT,
      HOST,
      NITRO_PORT: PORT,
      NITRO_HOST: HOST,
      STOREFRONT_API_URL: API_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exitCode = 0;
  try {
    await waitForReady(child);
    const result = await verifySsrSmoke({
      baseUrl: process.env['STOREFRONT_SMOKE_BASE_URL'] ?? `http://${HOST}:${PORT}`,
      apiUrl: API_URL,
      locales: (process.env['STOREFRONT_SMOKE_LOCALES'] ?? '')
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      timeoutMs: Number(process.env['STOREFRONT_SMOKE_TIMEOUT'] ?? 20_000),
    });
    if (!result.ok) {
      process.stderr.write('\n[ssr-smoke] FAILED\n');
      for (const failure of result.failures) {
        process.stderr.write(`  ${failure.kind} ${failure.label}\n    ${failure.message}\n`);
      }
      exitCode = result.fixtureBroken && !result.failures.some((f) => f.kind === 'FAIL') ? 2 : 1;
    } else {
      process.stdout.write('\n[ssr-smoke] PASS\n');
    }
  } catch (err) {
    process.stderr.write(
      `[ssr-smoke] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    exitCode = 2;
  } finally {
    await stop(child);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(2);
});
