export const environment = {
  production: true,
  /**
   * Relative on purpose.
   *
   * The engine ships one generic build, so this cannot name a deployment's API
   * origin. A relative base works wherever the admin is served behind a proxy
   * that forwards `/api` to the engine, which is the shape both the local and
   * the single-box install profiles produce. A split-origin deployment renders
   * an absolute origin here at install time, and widens the `connect-src` in
   * `apps/admin/nginx.conf` to match.
   */
  apiBaseUrl: '/api',
  sentryDsn: null as string | null,
  demoLogin: null as { email: string; password: string } | null,
};
