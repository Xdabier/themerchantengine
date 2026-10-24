import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

/** What the operator chose. `system` defers to `prefers-color-scheme`. */
export type ThemePreference = 'dark' | 'light' | 'system';

/** What the document actually renders. */
export type ThemeMode = 'dark' | 'light';

const PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];

/**
 * The one key the admin keeps in `localStorage`.
 *
 * Constitution §3.10 forbids auth material there and nothing else; a colour
 * preference carries none, and it has to survive a reload before Angular
 * boots or the operator sees the wrong mode flash on every navigation. The
 * inline script in `index.html` reads this same key for exactly that reason,
 * so the two must agree on its name and on its values.
 */
export const THEME_STORAGE_KEY = 'admin-theme';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * The admin's colour mode (constitution §3.9, DR-31).
 *
 * Dark is the reference floor and is what an operator who has expressed no
 * opinion gets on a system that has expressed none either. Everything here
 * degrades rather than throws: a browser with no `matchMedia`, a browser that
 * throws on `localStorage`, and a stored value nobody in this codebase wrote
 * all resolve to a mode the admin can render.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly document = inject(DOCUMENT);

  private readonly _preference = signal<ThemePreference>(this.readPreference());
  private readonly _systemPrefersLight = signal(this.querySystem());

  readonly preference = this._preference.asReadonly();

  /** The mode on the document right now. */
  readonly resolved = computed<ThemeMode>(() => {
    const preference = this._preference();
    if (preference !== 'system') return preference;
    return this._systemPrefersLight() ? 'light' : 'dark';
  });

  constructor() {
    this.watchSystem();
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.resolved());
    });
  }

  set(preference: ThemePreference): void {
    this._preference.set(preference);
    try {
      this.document.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // A browser that refuses to store it still renders it for this session.
    }
  }

  private readPreference(): ThemePreference {
    let stored: string | null = null;
    try {
      stored = this.document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      return 'system';
    }
    return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
  }

  private mediaQuery(): MediaQueryList | null {
    const view = this.document.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return null;
    return view.matchMedia(LIGHT_QUERY);
  }

  private querySystem(): boolean {
    return this.mediaQuery()?.matches ?? false;
  }

  private watchSystem(): void {
    // Tracked even while the preference is explicit: the operator can switch
    // back to `system` without reloading, and a listener attached only while
    // `system` is active would have missed whatever changed in between.
    this.mediaQuery()?.addEventListener('change', (event) => {
      this._systemPrefersLight.set(event.matches);
    });
  }
}
