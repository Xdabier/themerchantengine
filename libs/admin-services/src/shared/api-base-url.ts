import { InjectionToken } from '@angular/core';

/**
 * Provided by `apps/admin/src/app/app.config.ts` (imported via
 * `@admin/app/core/tokens`). Services inject this instead of depending on the
 * admin app directly, keeping the services lib stand-alone.
 */
export const ADMIN_API_BASE_URL = new InjectionToken<string>('ADMIN_API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});
