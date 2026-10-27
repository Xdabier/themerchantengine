/**
 * The `npx` arguments the e2e launcher serves the admin with.
 *
 * The host is pinned to 127.0.0.1. On Linux the dev server bound `localhost`
 * to [::1] only, and the global setup's identity fetch, which Node sent to
 * 127.0.0.1, was refused before a single test ran.
 *
 * CommonJS so the vitest spec can load it beside `e2e-server-marker.cjs`.
 */
function serveAdminArgs({ proxyConfigPath, adminPort }) {
  return [
    'nx',
    'serve',
    'admin',
    `--proxyConfig=${proxyConfigPath}`,
    `--port=${adminPort}`,
    '--host=127.0.0.1',
  ];
}

module.exports = { serveAdminArgs };
