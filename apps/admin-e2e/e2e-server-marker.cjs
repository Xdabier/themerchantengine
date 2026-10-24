/**
 * The marker that says an admin dev server on this port is an e2e server.
 *
 * `reuseExistingServer` was pinned to false for a real reason: a dev server
 * carries `proxy.conf.json`, whose target is the dev API on 53000, and reusing
 * one writes e2e fixtures into the developer's dev database. The cost of that
 * safety was a 180-second Angular boot on every single run.
 *
 * So the launcher records what it started, and reuse is allowed only when the
 * record matches the run that is about to begin: the same admin port, the same
 * API port, and a launcher process that is still alive. A dev server never wrote
 * this file, a crashed launcher leaves a pid that no longer answers, and a run
 * with different ports does not match. Every one of those falls back to booting
 * a fresh server, which is the old behaviour.
 *
 * CommonJS on purpose: `playwright.config.ts` compiles to CommonJS and cannot
 * require an ES module, while the ESM launcher can import this.
 */
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const MARKER_PATH = resolve(__dirname, '.playwright-state', 'e2e-server.json');

function writeMarker({ adminPort, apiPort, pid, path = MARKER_PATH }) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        adminPort: String(adminPort),
        apiPort: String(apiPort),
        pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function clearMarker(path = MARKER_PATH) {
  rmSync(path, { force: true });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   adminPort?: string | number,
 *   apiPort?: string | number,
 *   path?: string,
 *   read?: (path: string) => string,
 *   isAlive?: (pid: number) => boolean,
 * }} [options]
 * @returns {boolean}
 */
function isWarm({
  adminPort,
  apiPort,
  path = MARKER_PATH,
  read = (p) => readFileSync(p, 'utf8'),
  isAlive = alive,
} = {}) {
  let marker;
  try {
    marker = JSON.parse(read(path));
  } catch {
    return false;
  }

  if (marker?.adminPort !== String(adminPort)) return false;
  if (marker?.apiPort !== String(apiPort)) return false;
  if (typeof marker?.pid !== 'number') return false;
  return isAlive(marker.pid);
}

module.exports = { MARKER_PATH, writeMarker, clearMarker, isWarm };
