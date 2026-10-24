import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  openAssetPicker,
} from '@admin-ui';
import {
  SettingsService,
  type SettingsResponse,
  type UpdateSettingsRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  BRAND_TOKEN_KEYS,
  PaletteContrastError,
  generatePalette,
  type BrandTokenKey,
  type GeneratedPalette,
} from '@common/brand';
import { STORE_CONFIG_FONT_KITS } from '@common/store-config-fixtures/store-config-fixture.schema';
import { NEUTRAL_STORE_CONFIG } from '@common/store-config/neutral-store-config';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { readSetting } from './settings.utils';

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * The engine's own default primary, imported rather than typed here.
 *
 * The admin brand floor forbids a hex literal anywhere in this tree, and the
 * palette-token guard enforces it. That rule holds even on the one screen that
 * edits colours, because the colour a fresh install starts from is the
 * engine's answer, not this screen's: two copies of it would drift.
 */
const DEFAULT_PRIMARY = NEUTRAL_STORE_CONFIG.brand.baseColors.primary;

/** The neutral ground a colour input needs when a field is empty. */
const EMPTY_SWATCH = NEUTRAL_STORE_CONFIG.brand.baseColors.primary;

/** What the operator is told a font kit is for, in the order the enum lists them. */
const FONT_KIT_LABELS: Record<string, string> = {
  'latin-rounded': 'Latin — rounded sans',
  'arabic-latin': 'Arabic and Latin',
};

/**
 * `/settings/brand` — the base colours, the font kit and the brand artwork.
 *
 * The storefront palette is derived, never stored: the operator enters one to
 * three colours and `generatePalette` expands them into the full token set,
 * moving derived colours until every pair clears its contrast floor. This
 * screen runs that same generator on every keystroke, so the preview below the
 * pickers is the palette the storefront will actually render rather than an
 * approximation of it.
 *
 * When the generator refuses, the screen shows the refusal and does not save.
 * That is the point of the rejection path: the failing colour is one the
 * operator entered, so it is the only thing that can move, and storing it
 * would ship an unreadable storefront that no later screen would explain.
 */
@Component({
  selector: 'app-settings-brand-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="settings-brand-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Brand</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Brand</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          The colours and type the storefront is built from. The full palette is generated from
          these, not stored, so every derived colour is checked against its contrast floor before it
          ships. The admin keeps its own palette.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="settings-brand-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">{{ error() }}</p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-brand-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Brand saved.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="14rem" width="100%" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-6" novalidate>
          <fieldset class="flex flex-col gap-5" data-testid="settings-brand-colors">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Base colours</legend>

            <app-form-field
              label="Primary"
              fieldId="brand-primary"
              [required]="true"
              [error]="hexError('primary')"
              hint="Six-digit hex, e.g. a dark slate."
            >
              <div class="flex items-center gap-3">
                <input
                  type="color"
                  class="h-11 w-14 border border-line bg-surface"
                  [value]="swatchValue('primary')"
                  (input)="onSwatch('primary', $event)"
                  [attr.aria-label]="'Primary colour, picker for the hex field beside it'"
                  data-testid="settings-brand-primary-swatch"
                />
                <app-input
                  id="brand-primary"
                  type="text"
                  formControlName="primary"
                  [invalid]="!!hexError('primary')"
                  data-testid="settings-brand-primary"
                ></app-input>
              </div>
            </app-form-field>

            <app-form-field
              label="Secondary"
              fieldId="brand-secondary"
              [error]="hexError('secondary')"
              hint="Optional. Leave empty and the generator derives one."
            >
              <div class="flex items-center gap-3">
                <input
                  type="color"
                  class="h-11 w-14 border border-line bg-surface"
                  [value]="swatchValue('secondary')"
                  (input)="onSwatch('secondary', $event)"
                  [attr.aria-label]="'Secondary colour, picker for the hex field beside it'"
                  data-testid="settings-brand-secondary-swatch"
                />
                <app-input
                  id="brand-secondary"
                  type="text"
                  formControlName="secondary"
                  [invalid]="!!hexError('secondary')"
                  data-testid="settings-brand-secondary"
                ></app-input>
              </div>
            </app-form-field>

            <app-form-field
              label="Accent"
              fieldId="brand-accent"
              [error]="hexError('accent')"
              hint="Optional. Leave empty and the secondary, or the primary, stands in."
            >
              <div class="flex items-center gap-3">
                <input
                  type="color"
                  class="h-11 w-14 border border-line bg-surface"
                  [value]="swatchValue('accent')"
                  (input)="onSwatch('accent', $event)"
                  [attr.aria-label]="'Accent colour, picker for the hex field beside it'"
                  data-testid="settings-brand-accent-swatch"
                />
                <app-input
                  id="brand-accent"
                  type="text"
                  formControlName="accent"
                  [invalid]="!!hexError('accent')"
                  data-testid="settings-brand-accent"
                ></app-input>
              </div>
            </app-form-field>
          </fieldset>

          <section class="flex flex-col gap-3" aria-labelledby="brand-preview-heading">
            <h2 id="brand-preview-heading" class="text-xs tracking-widest uppercase text-ink-muted">
              Generated palette
            </h2>

            @if (paletteError()) {
              <p
                class="border border-status-error text-ink p-3 tabular text-xs"
                data-testid="settings-brand-palette-error"
              >
                {{ paletteError() }}
              </p>
            } @else if (palette(); as generated) {
              <ul
                class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
                role="list"
                data-testid="settings-brand-palette"
              >
                @for (token of tokenKeys; track token) {
                  <li class="border border-line p-2 flex items-center gap-2">
                    <span
                      class="h-6 w-6 border border-line shrink-0"
                      aria-hidden="true"
                      [style.background-color]="generated.tokens[token]"
                    ></span>
                    <span class="flex flex-col min-w-0">
                      <span class="text-xs tabular text-ink truncate">{{ token }}</span>
                      <span class="text-xs tabular font-mono text-ink-muted">
                        {{ generated.tokens[token] }}
                      </span>
                    </span>
                  </li>
                }
              </ul>

              <div data-testid="settings-brand-contrast-report">
                @if (generated.adjustments.length === 0) {
                  <p class="tabular text-xs text-ink-muted">
                    Every derived colour cleared its contrast floor unchanged.
                  </p>
                } @else {
                  <p class="tabular text-xs text-ink-muted">
                    {{ generated.adjustments.length }} colour(s) were moved so every pair clears its
                    contrast floor:
                  </p>
                  <ul class="mt-2 flex flex-col gap-1" role="list">
                    @for (move of generated.adjustments; track move.token + move.reason) {
                      <li class="tabular text-xs text-ink">
                        {{ move.token }} — {{ adjustmentReason(move.reason) }} — {{ move.from }} to
                        {{ move.to }}
                        @if (move.ratio) {
                          <span class="text-ink-muted">
                            (reaches {{ move.ratio.toFixed(2) }}:1)
                          </span>
                        }
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </section>

          <fieldset class="flex flex-col gap-5" data-testid="settings-brand-type">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Type and marks</legend>

            <div class="flex flex-col gap-2">
              <label for="brand-font-kit" class="text-xs tracking-widest uppercase text-ink-muted">
                Font kit
              </label>
              <select
                id="brand-font-kit"
                formControlName="fontKit"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="settings-brand-font-kit"
              >
                @for (kit of fontKits; track kit) {
                  <option [value]="kit">{{ fontKitLabel(kit) }}</option>
                }
              </select>
              <p class="text-xs tabular text-ink-muted">
                A store that enables an Arabic locale needs the Arabic kit; the storefront config
                refuses the pairing otherwise.
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div class="flex flex-col gap-2" data-testid="settings-brand-logo">
                <span class="text-xs tracking-widest uppercase text-ink-muted">Logo</span>
                <p class="tabular text-xs text-ink font-mono break-all">
                  {{ form.controls.logoAssetId.value || 'Not set' }}
                </p>
                <div class="flex items-center gap-3">
                  <app-button
                    type="button"
                    variant="ghost"
                    size="sm"
                    (clicked)="pickAsset('logoAssetId')"
                    data-testid="settings-brand-logo-pick"
                  >
                    Choose
                  </app-button>
                  <app-button
                    type="button"
                    variant="ghost"
                    size="sm"
                    [disabled]="!form.controls.logoAssetId.value"
                    (clicked)="clearAsset('logoAssetId')"
                    data-testid="settings-brand-logo-clear"
                  >
                    Clear
                  </app-button>
                </div>
              </div>

              <div class="flex flex-col gap-2" data-testid="settings-brand-favicon">
                <span class="text-xs tracking-widest uppercase text-ink-muted">Favicon</span>
                <p class="tabular text-xs text-ink font-mono break-all">
                  {{ form.controls.faviconAssetId.value || 'Not set' }}
                </p>
                <div class="flex items-center gap-3">
                  <app-button
                    type="button"
                    variant="ghost"
                    size="sm"
                    (clicked)="pickAsset('faviconAssetId')"
                    data-testid="settings-brand-favicon-pick"
                  >
                    Choose
                  </app-button>
                  <app-button
                    type="button"
                    variant="ghost"
                    size="sm"
                    [disabled]="!form.controls.faviconAssetId.value"
                    (clicked)="clearAsset('faviconAssetId')"
                    data-testid="settings-brand-favicon-clear"
                  >
                    Clear
                  </app-button>
                </div>
              </div>
            </div>
          </fieldset>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <p class="text-xs tabular text-ink-muted">
              {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy() || !form.dirty"
                (clicked)="revert()"
                data-testid="settings-brand-revert"
              >
                Revert
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="
                  form.invalid || busy() || !form.dirty || !canManage() || !!paletteError()
                "
                [loading]="busy()"
                data-testid="settings-brand-save"
              >
                Save
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class SettingsBrandPage implements OnInit, OnDestroy {
  private readonly service = inject(SettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly current = signal<SettingsResponse | null>(null);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  protected readonly tokenKeys: readonly BrandTokenKey[] = BRAND_TOKEN_KEYS;
  protected readonly fontKits: readonly string[] = STORE_CONFIG_FONT_KITS;

  readonly form = this.fb.nonNullable.group({
    primary: this.fb.nonNullable.control(DEFAULT_PRIMARY, [
      Validators.required,
      Validators.pattern(HEX_PATTERN),
    ]),
    secondary: this.fb.nonNullable.control(''),
    accent: this.fb.nonNullable.control(''),
    fontKit: this.fb.nonNullable.control<string>(STORE_CONFIG_FONT_KITS[0]),
    logoAssetId: this.fb.nonNullable.control(''),
    faviconAssetId: this.fb.nonNullable.control(''),
  });

  /**
   * The generated palette, recomputed on every colour change.
   *
   * A signal fed by the form's `valueChanges` rather than a `computed` over
   * the control getters: Reactive-Forms getters are untracked, so a computed
   * over one memoizes its first read and never updates again.
   */
  private readonly _palette = signal<GeneratedPalette | null>(null);
  private readonly _paletteError = signal<string | null>(null);

  readonly palette = this._palette.asReadonly();
  readonly paletteError = this._paletteError.asReadonly();

  ngOnInit(): void {
    this.form.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.regenerate());
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  hexError(control: 'primary' | 'secondary' | 'accent'): string | null {
    const c = this.form.controls[control];
    if (!c.touched) return null;
    const value = c.value.trim();
    if (value.length === 0) return control === 'primary' ? 'A primary colour is required.' : null;
    return HEX_PATTERN.test(value) ? null : 'Six digits after a hash, e.g. a dark slate.';
  }

  /** A native colour input needs a valid hex even when the field is empty. */
  swatchValue(control: 'primary' | 'secondary' | 'accent'): string {
    const value = this.form.controls[control].value.trim();
    if (HEX_PATTERN.test(value)) return value;
    return EMPTY_SWATCH;
  }

  onSwatch(control: 'primary' | 'secondary' | 'accent', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.controls[control].setValue(value.toUpperCase());
    this.form.controls[control].markAsDirty();
    this.form.controls[control].markAsTouched();
  }

  adjustmentReason(reason: string): string {
    if (reason === 'contrast') return 'moved for contrast';
    if (reason === 'no-accent-given') return 'derived, no accent given';
    if (reason === 'accent-from-secondary') return 'derived from the secondary';
    return reason;
  }

  fontKitLabel(kit: string): string {
    return FONT_KIT_LABELS[kit] ?? kit;
  }

  async pickAsset(control: 'logoAssetId' | 'faviconAssetId'): Promise<void> {
    const result = await openAssetPicker(this.dialog, {
      mode: 'single',
      title: control === 'logoAssetId' ? 'Choose a logo' : 'Choose a favicon',
      filter: { type: 'IMAGE' },
    });
    if (result.kind !== 'select-single') return;
    this.form.controls[control].setValue(result.asset.id);
    this.form.controls[control].markAsDirty();
  }

  clearAsset(control: 'logoAssetId' | 'faviconAssetId'): void {
    this.form.controls[control].setValue('');
    this.form.controls[control].markAsDirty();
  }

  revert(): void {
    const settings = this.current();
    if (settings) this.seedForm(settings);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;
    // The generator is the gate, not a preview: a palette it refuses is a
    // storefront nobody can read, and the colour it refuses is the operator's
    // own, so there is nothing else to move.
    if (this.paletteError()) return;

    const raw = this.form.getRawValue();
    const body: UpdateSettingsRequest = {};
    const colorsDirty =
      this.form.controls.primary.dirty ||
      this.form.controls.secondary.dirty ||
      this.form.controls.accent.dirty;
    // The whole object, always: the API replaces the stored JSON wholesale, so
    // sending one changed colour would clear the other two.
    if (colorsDirty) {
      body.baseColors = {
        primary: raw.primary.trim(),
        secondary: raw.secondary.trim() || null,
        accent: raw.accent.trim() || null,
      };
    }
    if (this.form.controls.fontKit.dirty) {
      body.fontKit = raw.fontKit as UpdateSettingsRequest['fontKit'];
    }
    // Empty clears the reference, and the column is nullable, so `null` is the
    // clear rather than the empty string every other cleared setting uses.
    if (this.form.controls.logoAssetId.dirty) body.logoAssetId = raw.logoAssetId.trim() || null;
    if (this.form.controls.faviconAssetId.dirty) {
      body.faviconAssetId = raw.faviconAssetId.trim() || null;
    }

    this.busy.set(true);
    this.error.set(null);
    this.service.update(body).subscribe({
      next: (next) => {
        this.busy.set(false);
        this.current.set(next);
        this.seedForm(next);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save brand settings.'));
      },
    });
  }

  private regenerate(): void {
    const raw = this.form.getRawValue();
    const primary = raw.primary.trim();
    if (!HEX_PATTERN.test(primary)) {
      this._palette.set(null);
      this._paletteError.set(null);
      return;
    }
    const optional = (value: string): string | null => {
      const trimmed = value.trim();
      return HEX_PATTERN.test(trimmed) ? trimmed : null;
    };
    try {
      this._palette.set(
        generatePalette({
          primary,
          secondary: optional(raw.secondary),
          accent: optional(raw.accent),
        }),
      );
      this._paletteError.set(null);
    } catch (err: unknown) {
      this._palette.set(null);
      this._paletteError.set(
        err instanceof PaletteContrastError || err instanceof Error
          ? err.message
          : 'This palette could not be generated.',
      );
    }
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (settings) => {
          this.current.set(settings);
          this.seedForm(settings);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(settings: SettingsResponse): void {
    const colors = readSetting<Record<string, unknown>>(settings, 'brand', 'baseColors', {});
    const hex = (value: unknown, fallback = ''): string =>
      typeof value === 'string' && HEX_PATTERN.test(value) ? value : fallback;
    this.form.reset(
      {
        primary: hex(colors?.['primary'], DEFAULT_PRIMARY),
        secondary: hex(colors?.['secondary']),
        accent: hex(colors?.['accent']),
        fontKit: readSetting<string>(settings, 'brand', 'fontKit', STORE_CONFIG_FONT_KITS[0]),
        logoAssetId: readSetting<string>(settings, 'brand', 'logoAssetId', '') ?? '',
        faviconAssetId: readSetting<string>(settings, 'brand', 'faviconAssetId', '') ?? '',
      },
      { emitEvent: false },
    );
    this.regenerate();
  }

  private formatError(err: unknown, fallback = 'Could not load brand settings.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage the brand.';
    if (err instanceof ApiNotFoundError) return 'Brand settings not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
