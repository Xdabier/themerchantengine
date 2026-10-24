import type { ConfigService } from '@nestjs/config';

/**
 * Public base URL for API endpoints that appear in OUTBOUND email links
 * (newsletter double-opt-in confirm, RFC-8058 one-click / footer unsubscribe).
 *
 * Combines `API_PUBLIC_BASE_URL` with the `API_GLOBAL_PREFIX` the app is
 * actually mounted under. Without the prefix the link resolves to `/v1/...`,
 * which 404s on every deployment that sets a global prefix — prod runs
 * `API_GLOBAL_PREFIX=api`, so the real route is `/api/v1/...`. The Better Auth
 * mount (`auth.ts`) already honours the same env var; these email links must
 * too, or confirm + unsubscribe are dead links in the inbox.
 *
 * Falls back to `process.env` for the prefix so a bare ConfigService (no
 * registered key) still resolves it.
 */
export function resolvePublicApiBase(config: ConfigService): string {
  const base = config
    .get<string>('API_PUBLIC_BASE_URL', 'https://api.example.test')
    .replace(/\/+$/, '');
  const rawPrefix = config.get<string>('API_GLOBAL_PREFIX') ?? process.env.API_GLOBAL_PREFIX ?? '';
  const prefix = rawPrefix.replace(/^\/+|\/+$/g, '');
  return prefix ? `${base}/${prefix}` : base;
}
