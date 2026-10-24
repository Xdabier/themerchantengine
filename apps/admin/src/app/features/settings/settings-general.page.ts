import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
  type TranslatableValue,
} from '@admin-ui';
import {
  SettingsService,
  type SettingsResponse,
  type UpdateSettingsRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { readSetting } from './settings.utils';
import { CurrencyStore } from '../../core/stores/currency.store';

/**
 * The platforms `STORE_CONFIG.general.socialLinks` defines. Held here rather
 * than derived from the stored object: a fixed list gives the operator an
 * empty field to fill in for a platform that has no row yet, which a
 * key-driven form could never render.
 */
const SOCIAL_PLATFORMS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter', label: 'Twitter' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'tiktok', label: 'TikTok' },
] as const;

type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number]['key'];

/**
 * Empty, or an absolute `http(s)` URL. Relative values are refused on purpose:
 * the storefront publishes these as schema.org `sameAs`, and resolving a typo
 * against the site origin would tell a crawler that https://demo.example/typo is
 * this brand's Facebook page.
 */
const SOCIAL_URL_PATTERN = /^$|^https?:\/\/\S+$/;

/** Mirrors the DTO: a lowercase slug of at most forty characters. */
const BRAND_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Mirrors the DTO: an ISO 3166-1 alpha-2 code, or empty until set. */
const COUNTRY_CODE_PATTERN = /^$|^[A-Z]{2}$/;

/**
 * `/settings/general` — store name, contact, timezone.
 *
 * The store currency is shown here read-only and edited at `/currencies`.
 * It used to be an editable free-text field on this screen, which was a second
 * editor writing a second copy of the same fact: it read the wrong settings
 * group so it always displayed USD, and saving sent `{ code }` alone, which
 * replaced the whole stored object and destroyed the symbol and decimal places
 * for the entire store.
 *
 * The backend's settings endpoint is grouped (`{ general: {...},
 * localization: {...} }`) but PATCH accepts a flat body. Each field
 * reads from its group on load and writes flat on save. The form is
 * dirty-aware so a PATCH only carries changed keys.
 */
@Component({
  selector: 'app-settings-general-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="settings-general-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">General</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">General</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          Store identity + defaults the storefront reads at request time.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="settings-general-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-general-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Settings saved.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="10rem" width="100%" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5" novalidate>
          <app-form-field label="Store name" fieldId="gen-name" [required]="true">
            <app-translatable-input
              formControlName="storeName"
              label="Store name"
              inputId="gen-name"
              idPrefix="gen-name"
              testId="gen-name"
            ></app-translatable-input>
          </app-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field
              label="Contact email"
              fieldId="gen-email"
              [error]="emailError()"
              hint="Surfaced in footer + transactional emails."
            >
              <app-input
                id="gen-email"
                type="email"
                formControlName="contactEmail"
                [invalid]="!!emailError()"
              ></app-input>
            </app-form-field>
            <app-form-field label="Phone" fieldId="gen-phone">
              <app-input id="gen-phone" type="tel" formControlName="phone"></app-input>
            </app-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field
              label="Timezone"
              fieldId="gen-tz"
              hint="IANA zone id, e.g. Europe/Paris or America/New_York."
            >
              <app-input id="gen-tz" type="text" formControlName="timezone"></app-input>
            </app-form-field>
            <app-form-field
              label="Tax registration number"
              fieldId="gen-tax-reg"
              hint="Printed on every invoice. A French facture requires the SIRET."
            >
              <app-input
                id="gen-tax-reg"
                type="text"
                formControlName="taxRegistrationNumber"
                data-testid="settings-tax-registration"
              ></app-input>
            </app-form-field>
            <div class="flex flex-col gap-2" data-testid="settings-store-currency">
              <p class="text-xs tracking-widest uppercase text-ink-muted">Store currency</p>
              <p class="tabular text-sm text-ink">
                {{ storeCode() ?? 'Not set' }}
              </p>
              <a
                routerLink="/currencies"
                class="tabular text-xs text-ink underline underline-offset-4 hover:text-ink-emphasis focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="settings-currency-link"
              >
                Manage currencies
              </a>
            </div>
          </div>

          <fieldset class="flex flex-col gap-5" data-testid="settings-identity">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Identity</legend>
            <app-form-field
              label="Brand slug"
              fieldId="gen-brand-name"
              [error]="brandNameError()"
              hint="Lowercase, digits and hyphens. Used in slugs, asset paths and the installer banner."
            >
              <app-input
                id="gen-brand-name"
                type="text"
                formControlName="brandName"
                [invalid]="!!brandNameError()"
                data-testid="settings-brand-name"
              ></app-input>
            </app-form-field>

            <app-form-field
              label="Store description"
              fieldId="gen-description"
              hint="One paragraph. Feeds the storefront meta description and llms.txt."
            >
              <app-translatable-input
                inputId="gen-description"
                idPrefix="gen-description"
                testId="settings-description"
                label="Store description"
                [multiline]="true"
                formControlName="description"
              ></app-translatable-input>
            </app-form-field>
          </fieldset>

          <fieldset class="flex flex-col gap-5" data-testid="settings-legal-entity">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Legal entity</legend>
            <p class="text-xs tabular text-ink-muted">
              Printed on invoices and published as the Organization structured data.
            </p>

            <app-form-field label="Legal name" fieldId="gen-legal-name">
              <app-translatable-input
                inputId="gen-legal-name"
                idPrefix="gen-legal-name"
                testId="settings-legal-name"
                label="Legal name"
                formControlName="legalName"
              ></app-translatable-input>
            </app-form-field>

            <app-form-field
              label="Trading name"
              fieldId="gen-trading-name"
              hint="The name the business trades under, when it differs from the legal one."
            >
              <app-translatable-input
                inputId="gen-trading-name"
                idPrefix="gen-trading-name"
                testId="settings-trading-name"
                label="Trading name"
                formControlName="tradingName"
              ></app-translatable-input>
            </app-form-field>

            <app-form-field label="Street address" fieldId="gen-street-address">
              <app-translatable-input
                inputId="gen-street-address"
                idPrefix="gen-street-address"
                testId="settings-street-address"
                label="Street address"
                formControlName="streetAddress"
              ></app-translatable-input>
            </app-form-field>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <app-form-field label="City" fieldId="gen-locality">
                <app-input
                  id="gen-locality"
                  type="text"
                  formControlName="addressLocality"
                  data-testid="settings-address-locality"
                ></app-input>
              </app-form-field>
              <app-form-field label="Region" fieldId="gen-region">
                <app-input
                  id="gen-region"
                  type="text"
                  formControlName="addressRegion"
                  data-testid="settings-address-region"
                ></app-input>
              </app-form-field>
              <app-form-field label="Postal code" fieldId="gen-postal-code">
                <app-input
                  id="gen-postal-code"
                  type="text"
                  formControlName="postalCode"
                  data-testid="settings-postal-code"
                ></app-input>
              </app-form-field>
              <app-form-field
                label="Country"
                fieldId="gen-country"
                [error]="countryError()"
                hint="ISO 3166-1 alpha-2, e.g. FR. Leave empty until set."
              >
                <app-input
                  id="gen-country"
                  type="text"
                  formControlName="addressCountry"
                  [invalid]="!!countryError()"
                  data-testid="settings-address-country"
                ></app-input>
              </app-form-field>
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-3" data-testid="settings-social-links">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">
              Social profiles
            </legend>
            <p class="text-sm text-ink">
              Full profile URLs. Each one renders in the storefront footer; leave a field empty to
              drop that platform.
            </p>
            <div
              class="grid grid-cols-1 md:grid-cols-2 gap-5"
              [formGroup]="form.controls.socialLinks"
            >
              @for (platform of socialPlatforms; track platform.key) {
                <app-form-field
                  [label]="platform.label"
                  [fieldId]="'gen-social-' + platform.key"
                  [error]="socialError(platform.key)"
                >
                  <app-input
                    [id]="'gen-social-' + platform.key"
                    type="url"
                    [formControlName]="platform.key"
                    [invalid]="!!socialError(platform.key)"
                    [attr.data-testid]="'settings-social-' + platform.key"
                  ></app-input>
                </app-form-field>
              }
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
                data-testid="settings-general-revert"
              >
                Revert
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty || !canManage()"
                [loading]="busy()"
                data-testid="settings-general-save"
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
export class SettingsGeneralPage implements OnInit, OnDestroy {
  private readonly service = inject(SettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly currencyStore = inject(CurrencyStore);

  /** Read-only: `/currencies` is the single editor for this (plan A, D3). */
  protected readonly storeCode = this.currencyStore.code;
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly current = signal<SettingsResponse | null>(null);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly form = this.fb.nonNullable.group({
    storeName: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [
      Validators.required,
    ]),
    contactEmail: this.fb.nonNullable.control('', [Validators.email]),
    phone: this.fb.nonNullable.control(''),
    timezone: this.fb.nonNullable.control(''),
    // The seller's tax registration number, printed on the invoice. This is
    // the only screen that edits store identity, and its form had four
    // controls, none of them from the business group — so the group was
    // defined, registered, and unreachable by any operator.
    taxRegistrationNumber: this.fb.nonNullable.control('', [Validators.maxLength(64)]),
    // Identity (E1.1) and the legal entity. Both groups were registered,
    // defaulted and unreachable: this is the only screen that edits store
    // identity, and none of these keys had a control on it.
    brandName: this.fb.nonNullable.control('', [Validators.pattern(BRAND_SLUG_PATTERN)]),
    description: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    legalName: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    tradingName: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    streetAddress: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    addressLocality: this.fb.nonNullable.control('', [Validators.maxLength(120)]),
    addressRegion: this.fb.nonNullable.control('', [Validators.maxLength(120)]),
    postalCode: this.fb.nonNullable.control('', [Validators.maxLength(20)]),
    addressCountry: this.fb.nonNullable.control('', [Validators.pattern(COUNTRY_CODE_PATTERN)]),
    // `socialLinks` has been a valid API key with a default since the settings
    // module shipped, and this is the only screen that edits store identity,
    // so the operator had no editor for it. The storefront footer renders it
    // (plan I phase I2), which is what made the gap visible.
    socialLinks: this.fb.nonNullable.group(
      Object.fromEntries(
        SOCIAL_PLATFORMS.map((platform) => [
          platform.key,
          this.fb.nonNullable.control('', [Validators.pattern(SOCIAL_URL_PATTERN)]),
        ]),
      ) as Record<SocialPlatformKey, FormControl<string>>,
    ),
  });

  protected readonly socialPlatforms = SOCIAL_PLATFORMS;

  /**
   * A plain method, not a `computed()`. Reactive-Forms getters are untracked,
   * so a computed over one memoizes its first read and never updates
   * (standing project rule).
   */
  socialError(platform: SocialPlatformKey): string | null {
    const control = this.form.controls.socialLinks.controls[platform];
    if (!control.touched || control.valid) return null;
    return 'Enter a full profile URL starting with https://, or leave it empty.';
  }

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  brandNameError(): string | null {
    const c = this.form.controls.brandName;
    if (!c.touched || c.valid) return null;
    return 'Lowercase letters, digits and hyphens, at most 40 characters.';
  }

  countryError(): string | null {
    const c = this.form.controls.addressCountry;
    if (!c.touched || c.valid) return null;
    return 'Two uppercase letters, e.g. FR. Leave empty until set.';
  }

  emailError(): string | null {
    const c = this.form.controls.contactEmail;
    if (!c.touched || c.valid) return null;
    if (c.hasError('email')) return 'Enter a valid email address.';
    return null;
  }

  revert(): void {
    const settings = this.current();
    if (settings) this.seedForm(settings);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;
    const raw = this.form.getRawValue();
    const body: UpdateSettingsRequest = {};
    if (this.form.controls.storeName.dirty) body.storeName = raw.storeName;
    if (this.form.controls.contactEmail.dirty)
      body.contactEmail = raw.contactEmail.trim() || undefined;
    if (this.form.controls.phone.dirty) body.phone = raw.phone.trim();
    if (this.form.controls.timezone.dirty) body.timezone = raw.timezone.trim();
    if (this.form.controls.taxRegistrationNumber.dirty)
      body.taxRegistrationNumber = raw.taxRegistrationNumber.trim();
    if (this.form.controls.brandName.dirty) body.brandName = raw.brandName.trim();
    if (this.form.controls.description.dirty) body.description = raw.description;
    if (this.form.controls.legalName.dirty) body.legalName = raw.legalName;
    if (this.form.controls.tradingName.dirty) body.tradingName = raw.tradingName;
    if (this.form.controls.streetAddress.dirty) body.streetAddress = raw.streetAddress;
    if (this.form.controls.addressLocality.dirty) body.addressLocality = raw.addressLocality.trim();
    if (this.form.controls.addressRegion.dirty) body.addressRegion = raw.addressRegion.trim();
    if (this.form.controls.postalCode.dirty) body.postalCode = raw.postalCode.trim();
    if (this.form.controls.addressCountry.dirty) body.addressCountry = raw.addressCountry.trim();
    // The whole object, always. The API upsert replaces the stored JSON value
    // wholesale, so sending only the platform that changed would erase every
    // other one.
    if (this.form.controls.socialLinks.dirty) {
      body.socialLinks = Object.fromEntries(
        SOCIAL_PLATFORMS.map((platform) => [platform.key, raw.socialLinks[platform.key].trim()]),
      );
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
        this.error.set(this.formatError(err, 'Could not save settings.'));
      },
    });
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
    const storeName = readSetting<TranslatableValue | string | null>(
      settings,
      'general',
      'storeName',
      null,
    );
    this.form.reset(
      {
        storeName: this.normalizeTranslatable(storeName),
        contactEmail: readSetting<string>(settings, 'general', 'contactEmail', ''),
        phone: readSetting<string>(settings, 'general', 'phone', ''),
        timezone: readSetting<string>(settings, 'localization', 'timezone', ''),
        taxRegistrationNumber: readSetting<string>(
          settings,
          'business',
          'taxRegistrationNumber',
          '',
        ),
        socialLinks: this.readSocialLinks(settings),
        brandName: readSetting<string>(settings, 'identity', 'brandName', ''),
        description: this.normalizeTranslatable(
          readSetting<TranslatableValue | string | null>(settings, 'identity', 'description', null),
        ),
        legalName: this.normalizeTranslatable(
          readSetting<TranslatableValue | string | null>(settings, 'business', 'legalName', null),
        ),
        tradingName: this.normalizeTranslatable(
          readSetting<TranslatableValue | string | null>(settings, 'business', 'tradingName', null),
        ),
        streetAddress: this.normalizeTranslatable(
          readSetting<TranslatableValue | string | null>(
            settings,
            'business',
            'streetAddress',
            null,
          ),
        ),
        addressLocality: readSetting<string>(settings, 'business', 'addressLocality', ''),
        addressRegion: readSetting<string>(settings, 'business', 'addressRegion', ''),
        postalCode: readSetting<string>(settings, 'business', 'postalCode', ''),
        addressCountry: readSetting<string>(settings, 'business', 'addressCountry', ''),
      },
      { emitEvent: false },
    );
  }

  /** Every platform gets a key, so a stored object missing one seeds it empty
   * rather than leaving the control undefined. */
  private readSocialLinks(settings: SettingsResponse): Record<SocialPlatformKey, string> {
    const stored = readSetting<Record<string, unknown>>(settings, 'general', 'socialLinks', {});
    return Object.fromEntries(
      SOCIAL_PLATFORMS.map((platform) => [
        platform.key,
        typeof stored?.[platform.key] === 'string' ? (stored[platform.key] as string) : '',
      ]),
    ) as Record<SocialPlatformKey, string>;
  }

  private normalizeTranslatable(v: unknown): TranslatableValue {
    if (v && typeof v === 'object' && 'default' in (v as object)) {
      return v as TranslatableValue;
    }
    if (typeof v === 'string') return { default: v };
    return { default: '' };
  }

  private formatError(err: unknown, fallback = 'Could not load settings.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage settings.';
    if (err instanceof ApiNotFoundError) return 'Settings not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
