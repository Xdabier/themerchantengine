import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, SkeletonComponent } from '@admin-ui';
import { SettingsService, type SettingsLocales, type SettingsResponse } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { LOCALE_CATALOGUE, getLocaleDefinition, isCatalogueLocale } from '@common/locale';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { localeLabel } from '../../shared/format/locale';
import { readSetting } from './settings.utils';

interface LocaleOption {
  code: string;
  label: string;
}

/**
 * The locales this store can offer, default first.
 *
 * Read from the engine catalogue rather than typed here. The literal this
 * replaced offered five locales, three of which the backend refuses: the
 * settings DTO validates every locale against `LOCALE_CATALOGUE`, so enabling
 * Spanish through this screen answered 400 and the screen was the only place
 * that claimed the store could speak it. Labels come from the shared helper so
 * this and every other locale-rendering surface cannot drift apart.
 */
const CATALOGUE: readonly LocaleOption[] = LOCALE_CATALOGUE.map((code) => ({
  code,
  label: localeLabel(code),
}));

function isRtlLocale(code: string): boolean {
  return getLocaleDefinition(code)?.direction === 'rtl';
}

/**
 * `/settings/locales` — supported languages + default.
 *
 * Rendered as a checkbox grid (supported) plus a native select for
 * the default. The backend validates `defaultLocale ∈ supportedLocales`
 * — we mirror that client-side so the Save button stays disabled
 * until the rule holds, and the default dropdown disables unselected
 * rows.
 */
@Component({
  selector: 'app-settings-locales-page',
  standalone: true,
  imports: [RouterLink, ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="settings-locales-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Locales</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Locales</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          Which languages the storefront offers at checkout + which one renders first when the
          customer has no preference cached.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="settings-locales-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-locales-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Locales saved.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="8rem" width="100%" />
        </div>
      } @else {
        <fieldset class="border border-line p-4" data-testid="settings-locales-supported">
          <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
            Supported locales
          </legend>
          <p class="text-xs tabular text-ink-muted mb-3">
            At least one locale is required. The default must be in this list.
          </p>
          <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="list">
            @for (opt of catalogue; track opt.code) {
              <li>
                <label class="flex items-center gap-3 text-sm tabular">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-ink"
                    [checked]="isSupported(opt.code)"
                    [disabled]="!canManage()"
                    (change)="toggleSupported(opt.code, $event)"
                    [attr.data-testid]="'settings-locale-' + opt.code"
                  />
                  <span>{{ opt.label }}</span>
                  <span class="text-ink-muted text-xs font-mono ms-auto">{{ opt.code }}</span>
                </label>
              </li>
            }
          </ul>
        </fieldset>

        <fieldset class="flex flex-col gap-3" data-testid="settings-locales-rtl">
          <legend class="text-xs tracking-widest uppercase text-ink-muted">
            Writing direction
          </legend>
          <p class="text-xs tabular text-ink-muted mb-3">
            Each language is written in one direction. Every Translatable editor in the admin
            follows it, tab by tab.
          </p>
          <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="list">
            @for (opt of catalogue; track opt.code) {
              @if (isSupported(opt.code)) {
                <li class="flex items-center gap-3 text-sm tabular">
                  <span>{{ opt.label }}</span>
                  <span
                    class="text-ink-muted text-xs ms-auto"
                    [attr.data-testid]="'settings-direction-' + opt.code"
                  >
                    {{ directionLabel(opt.code) }}
                  </span>
                </li>
              }
            }
          </ul>
          @if (supported().size === 0) {
            <p class="text-xs tabular text-ink-muted">Enable a locale first.</p>
          }
        </fieldset>

        <div class="flex flex-col gap-3 max-w-sm">
          <label
            for="settings-default-locale"
            class="text-xs tracking-widest uppercase text-ink-muted"
          >
            Default locale
          </label>
          <select
            id="settings-default-locale"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="defaultLocale() ?? ''"
            (change)="onDefaultChange($event)"
            data-testid="settings-default-locale-select"
          >
            @for (opt of catalogue; track opt.code) {
              <option
                [value]="opt.code"
                [selected]="opt.code === defaultLocale()"
                [disabled]="!isSupported(opt.code)"
              >
                {{ opt.label }} ({{ opt.code }})
              </option>
            }
          </select>
        </div>

        <footer
          class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
        >
          <p class="text-xs tabular text-ink-muted">
            {{ supported().size }} enabled · default {{ defaultLocale() ?? '—' }}
          </p>
          <div class="flex items-center gap-3">
            <app-button
              type="button"
              variant="ghost"
              size="sm"
              [disabled]="busy() || !dirty()"
              (clicked)="revert()"
              data-testid="settings-locales-revert"
            >
              Revert
            </app-button>
            <app-button
              type="button"
              variant="primary"
              size="md"
              [disabled]="
                busy() || !dirty() || !canManage() || supported().size === 0 || !defaultValid()
              "
              [loading]="busy()"
              (clicked)="save()"
              data-testid="settings-locales-save"
            >
              Save
            </app-button>
          </div>
        </footer>
      }
    </section>
  `,
})
export class SettingsLocalesPage implements OnInit, OnDestroy {
  private readonly service = inject(SettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);

  readonly supported = signal<ReadonlySet<string>>(new Set());
  readonly defaultLocale = signal<string | null>(null);

  /** The enabled locales the registry writes right to left. */
  readonly rtl = computed<ReadonlySet<string>>(
    () => new Set([...this.supported()].filter(isRtlLocale)),
  );

  private initialSupported: ReadonlySet<string> = new Set();
  private initialDefault: string | null = null;
  private initialRtl: ReadonlySet<string> = new Set();

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly dirty = computed(() => {
    const s = this.supported();
    if (s.size !== this.initialSupported.size) return true;
    for (const v of s) if (!this.initialSupported.has(v)) return true;
    if (this.defaultLocale() !== this.initialDefault) return true;
    return this.rtlDirty();
  });

  readonly rtlDirty = computed(() => {
    const r = this.rtl();
    if (r.size !== this.initialRtl.size) return true;
    for (const v of r) if (!this.initialRtl.has(v)) return true;
    return false;
  });

  readonly defaultValid = computed(() => {
    const d = this.defaultLocale();
    return !!d && this.supported().has(d);
  });

  protected readonly catalogue = CATALOGUE;
  protected readonly localeLabel = localeLabel;

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isSupported(code: string): boolean {
    return this.supported().has(code);
  }

  directionLabel(code: string): string {
    return isRtlLocale(code) ? 'Right to left' : 'Left to right';
  }

  toggleSupported(code: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.supported());
    if (checked) next.add(code);
    else {
      next.delete(code);
      if (this.defaultLocale() === code) this.defaultLocale.set(null);
    }
    this.supported.set(next);
  }

  onDefaultChange(event: Event): void {
    this.defaultLocale.set((event.target as HTMLSelectElement).value || null);
  }

  revert(): void {
    this.supported.set(new Set(this.initialSupported));
    this.defaultLocale.set(this.initialDefault);
  }

  save(): void {
    if (this.busy() || !this.dirty()) return;
    const selected = [...this.supported()];
    if (selected.length === 0) {
      this.error.set('Enable at least one locale.');
      return;
    }
    // A stored locale outside the catalogue reaches this screen, because the
    // read schema stays loose so the screen that exists to correct it can
    // render it. Sending it back would be a 400 from the settings DTO, so the
    // refusal is named here instead.
    const list = selected.filter(isCatalogueLocale);
    if (list.length !== selected.length) {
      const unknown = selected.filter((code) => !isCatalogueLocale(code));
      this.error.set(`This engine ships no strings for: ${unknown.join(', ')}.`);
      return;
    }
    const def = this.defaultLocale();
    if (!def || !isCatalogueLocale(def) || !list.includes(def)) {
      this.error.set('Default locale must be in the enabled list.');
      return;
    }
    // Sent in the same body so the API checks the subset against the new set
    // and writes all three keys in one transaction.
    const rtl = list.filter(isRtlLocale);

    this.busy.set(true);
    this.error.set(null);
    this.service
      .updateLocales({ supportedLocales: list, defaultLocale: def, rtlLocales: rtl })
      .subscribe({
        next: (res) => {
          this.applyPair(res);
          this.initialRtl = new Set(rtl);
          this.finishSave();
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.error.set(this.formatError(err, 'Could not save locales.'));
        },
      });
  }

  private finishSave(): void {
    // Every Translatable editor in the app reads its tab list and its writing
    // direction from `StoreSettingsStore`, so without this the operator saves
    // a new locale set here and no editor shows it until the next full reload.
    this.storeSettings.refresh();
    this.busy.set(false);
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 3000);
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    // The grouped envelope rather than `GET /settings/locales`: the writing
    // direction lives in the same group and that endpoint returns only the
    // pair, so reading it separately would be a second request for one key.
    this.service
      .getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (groups) => {
          this.applyGroups(groups);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private applyPair(res: SettingsLocales): void {
    const set = new Set(res.supportedLocales);
    this.supported.set(set);
    this.initialSupported = new Set(set);
    this.defaultLocale.set(res.defaultLocale);
    this.initialDefault = res.defaultLocale;
  }

  private applyGroups(groups: SettingsResponse): void {
    const supported = readSetting<string[]>(groups, 'localization', 'supportedLocales', []);
    const fallback = readSetting<string>(groups, 'localization', 'defaultLocale', '');
    const rtl = readSetting<string[]>(groups, 'localization', 'rtlLocales', []);
    this.applyPair({ supportedLocales: supported, defaultLocale: fallback });
    this.initialRtl = new Set(rtl);
  }

  private formatError(err: unknown, fallback = 'Could not load locales.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage locales.';
    if (err instanceof ApiNotFoundError) return 'Locales not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
