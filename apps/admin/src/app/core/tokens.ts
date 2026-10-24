import { InjectionToken } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Injection tokens for cross-cutting config values. Prefer `inject(TOKEN)`
 * over reading from the environment directly so tests can override.
 */

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});

/**
 * Default locale used at bootstrap before the user profile loads.
 *
 * This, not `defaultLocale` in `@admin-types`, is what actually seeds
 * `AuthStore` and therefore what the admin sends as `Accept-Language` in every
 * session whose user row carries no locale of its own. The two must move
 * together or changing the other one is inert.
 */
export const BOOTSTRAP_LOCALE = new InjectionToken<string>('BOOTSTRAP_LOCALE', {
  providedIn: 'root',
  factory: () => 'fr',
});
