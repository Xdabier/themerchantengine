import { Pipe, PipeTransform, inject } from '@angular/core';
import type { Translatable } from '@admin-types';
import { pickTranslation } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * Reduce a `Translatable` JSONB value to a display string in the operator's
 * active locale. Admin reads send `X-Resolve-Locale: false` (constitution
 * §3.2), so name fields arrive as `{ default, fr, en }` objects, and binding one
 * directly renders "[object Object]". This pipe (wrapping `pickTranslation`) is
 * the single safe way to show one, and is idempotent on already-resolved
 * strings so it is safe to apply even where the backend resolved server-side.
 *
 * Impure so a profile locale switch re-resolves the label live; memoized on
 * `(value, locale, defaultLocale, fallback)` so steady-state cost is one map lookup per cell.
 *
 * Usage: `{{ entity.name | translatable }}` or `{{ entity.name | translatable: '—' }}`.
 */
@Pipe({ name: 'translatable', standalone: true, pure: false })
export class TranslatablePipe implements PipeTransform {
  private readonly auth = inject(AuthStore);
  private readonly settings = inject(StoreSettingsStore);

  private lastValue: Translatable | string | null | undefined;
  private lastLocale = '';
  private lastDefaultLocale = '';
  private lastFallback = '';
  private lastResult = '';
  private primed = false;

  transform(value: Translatable | string | null | undefined, fallback = ''): string {
    const locale = this.auth.locale();
    const defaultLocale = this.settings.defaultLocale();
    if (
      this.primed &&
      value === this.lastValue &&
      locale === this.lastLocale &&
      defaultLocale === this.lastDefaultLocale &&
      fallback === this.lastFallback
    ) {
      return this.lastResult;
    }
    this.lastValue = value;
    this.lastLocale = locale;
    this.lastDefaultLocale = defaultLocale;
    this.lastFallback = fallback;
    this.lastResult = pickTranslation(value, locale, fallback, defaultLocale);
    this.primed = true;
    return this.lastResult;
  }
}
