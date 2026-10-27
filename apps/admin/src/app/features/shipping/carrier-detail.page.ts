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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
  openConfirmDialog,
  type TranslatableValue,
} from '@admin-ui';
import { CarriersService, type Carrier, type UpdateCarrierRequest } from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

const SECRET_KEYS = new Set([
  'apiKey',
  'accountNumber',
  'clientSecret',
  'privateKey',
  'signingSecret',
]);

function carrierLabel(
  c: Pick<Carrier, 'name' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    c.name as Translatable | string | null | undefined,
    locale,
    c.code,
    defaultLocale,
  );
}

function providerLabel(p: string): string {
  const map: Record<string, string> = {
    dhl: 'DHL',
    fedex: 'FedEx',
    ups: 'UPS',
    aramex: 'Aramex',
    manual: 'Manual',
  };
  return map[p] ?? p;
}

/**
 * `/shipping/carriers/:id` — carrier editor.
 *
 * Same config grid pattern as payment methods — known secret keys render
 * masked, rotation preserves the stored secret when the placeholder is
 * resubmitted. Services + zones are comma-separated string arrays.
 */
@Component({
  selector: 'app-carrier-detail-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="carrier-detail-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/shipping/carriers"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Carriers
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">
          {{ current() ? label(current()!) : '…' }}
        </span>
      </nav>

      <div role="status" aria-live="polite" data-testid="carrier-detail-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="3rem" width="40%" />
          <app-skeleton height="14rem" width="100%" />
        </div>
      } @else if (current(); as c) {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">
              {{ providerLabel(c.provider) }}
            </p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ label(c) }}
            </h1>
            <p class="mt-3 tabular text-sm text-ink-muted">
              Code <code class="font-mono text-ink">{{ c.code }}</code>
            </p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <app-badge
              [tone]="c.isActive ? 'success' : 'neutral'"
              [ariaLabel]="c.isActive ? 'Active' : 'Disabled'"
            >
              {{ c.isActive ? 'Active' : 'Disabled' }}
            </app-badge>
            <span aria-live="polite" class="inline-flex">
              @if (saved()) {
                <app-badge tone="success" [ariaLabel]="'Changes saved'">Saved</app-badge>
              }
            </span>
          </div>
        </header>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field label="Display name" fieldId="car-name" [required]="true">
            <app-translatable-input
              formControlName="name"
              label="Name"
              inputId="car-name"
              idPrefix="car-name"
              testId="car-name"
            ></app-translatable-input>
          </app-form-field>

          <app-form-field
            label="Services"
            fieldId="car-services"
            hint="Comma-separated labels (e.g. express, economy, next-day)."
          >
            <app-input id="car-services" type="text" formControlName="services"></app-input>
          </app-form-field>

          <app-form-field
            label="Zones"
            fieldId="car-zones"
            [error]="zonesError()"
            hint="Comma-separated ISO alpha-2 country codes. Empty = ship anywhere."
          >
            <app-input
              id="car-zones"
              type="text"
              formControlName="zones"
              [invalid]="!!zonesError()"
            ></app-input>
          </app-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field
              label="Sort order"
              fieldId="car-sort"
              hint="Lower renders first on ties."
            >
              <app-input id="car-sort" type="number" formControlName="sortOrder"></app-input>
            </app-form-field>
            <div class="flex items-center pt-6">
              <label class="inline-flex items-center gap-3 text-sm tabular">
                <input
                  type="checkbox"
                  formControlName="isActive"
                  class="h-4 w-4 accent-ink"
                  data-testid="car-active"
                />
                Active at checkout
              </label>
            </div>
          </div>

          <section class="flex flex-col gap-4" aria-labelledby="car-config-heading">
            <header>
              <h2 id="car-config-heading" class="text-xs tracking-widest uppercase text-ink-muted">
                Provider config
              </h2>
              <p class="mt-1 text-xs tabular text-ink-muted">
                Known secret keys (apiKey, accountNumber, clientSecret…) are masked on read. Leaving
                the placeholder in place keeps the stored value.
              </p>
            </header>
            @if (configKeys().length === 0) {
              <p class="tabular text-sm text-ink-muted">No config keys yet.</p>
            } @else {
              <ul class="flex flex-col gap-3" role="list" data-testid="car-config-rows">
                @for (key of configKeys(); track key) {
                  <li
                    class="grid grid-cols-[1fr_2fr_auto] items-center gap-3"
                    [attr.data-testid]="'car-config-row-' + key"
                  >
                    <span class="font-mono text-xs text-ink">{{ key }}</span>
                    <input
                      [type]="isSecret(key) ? 'password' : 'text'"
                      autocomplete="off"
                      class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      [value]="configValue(key)"
                      [attr.aria-label]="'Value for ' + key"
                      [attr.data-testid]="'car-config-input-' + key"
                      (input)="onConfigInput(key, $event)"
                    />
                    <app-button
                      variant="ghost"
                      size="sm"
                      type="button"
                      (clicked)="removeConfigKey(key)"
                      [ariaLabel]="'Remove ' + key"
                      [attr.data-testid]="'car-config-remove-' + key"
                    >
                      Remove
                    </app-button>
                  </li>
                }
              </ul>
            }
            <div class="flex items-end gap-3 flex-wrap">
              <div class="flex-1 min-w-64">
                <label for="car-new-key" class="block text-xs tabular text-ink-muted mb-1">
                  New key
                </label>
                <input
                  id="car-new-key"
                  type="text"
                  class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  [value]="newKey()"
                  (input)="onNewKeyInput($event)"
                  placeholder="e.g. webhookUrl"
                />
              </div>
              <app-button
                type="button"
                variant="secondary"
                size="sm"
                [disabled]="!newKey() || hasKey(newKey())"
                (clicked)="addConfigKey()"
                data-testid="car-config-add"
              >
                Add key
              </app-button>
            </div>
          </section>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <div class="flex items-center gap-3">
              @if (canDelete()) {
                <app-button
                  type="button"
                  variant="destructive"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'delete'"
                  (clicked)="confirmDelete()"
                  data-testid="car-delete"
                >
                  Delete carrier
                </app-button>
              }
              <p class="text-xs tabular text-ink-muted">
                {{ form.dirty || configDirty() ? 'Unsaved changes' : 'No changes' }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                routerLink="/shipping/carriers"
                data-testid="car-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || (!form.dirty && !configDirty())"
                [loading]="busy() && action() === 'save'"
                data-testid="car-save"
              >
                Save changes
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class CarrierDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(CarriersService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<Carrier | null>(null);
  readonly busy = signal(false);
  readonly action = signal<'save' | 'delete' | null>(null);
  readonly saved = signal(false);

  readonly pendingConfig = signal<Record<string, unknown>>({});
  readonly configDirty = signal(false);
  readonly newKey = signal('');

  readonly configKeys = computed(() =>
    Object.keys(this.pendingConfig()).sort((a, b) => a.localeCompare(b)),
  );

  readonly canDelete = computed(() =>
    this.authStore.hasAnyPermission(['carriers:delete', 'carriers:manage']),
  );

  protected readonly label = (c: Pick<Carrier, 'name' | 'code'>): string =>
    carrierLabel(c, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly providerLabel = providerLabel;

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [Validators.required]),
    services: this.fb.nonNullable.control(''),
    zones: this.fb.nonNullable.control(''),
    sortOrder: this.fb.nonNullable.control(0, [Validators.min(0)]),
    isActive: this.fb.nonNullable.control(false),
  });

  isSecret(key: string): boolean {
    return SECRET_KEYS.has(key);
  }

  configValue(key: string): string {
    const v = this.pendingConfig()[key];
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return JSON.stringify(v);
  }

  hasKey(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.pendingConfig(), key);
  }

  onNewKeyInput(event: Event): void {
    this.newKey.set((event.target as HTMLInputElement).value.trim());
  }

  addConfigKey(): void {
    const key = this.newKey();
    if (!key || this.hasKey(key)) return;
    this.pendingConfig.update((cfg) => ({ ...cfg, [key]: '' }));
    this.newKey.set('');
    this.configDirty.set(true);
  }

  removeConfigKey(key: string): void {
    this.pendingConfig.update((cfg) => {
      const next = { ...cfg };
      delete next[key];
      return next;
    });
    this.configDirty.set(true);
  }

  onConfigInput(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pendingConfig.update((cfg) => ({ ...cfg, [key]: value }));
    this.configDirty.set(true);
  }

  zonesError(): string | null {
    const c = this.form.controls.zones;
    if (!c.touched) return null;
    const tokens = this.parseList(c.value);
    const bad = tokens.find((t) => !/^[A-Z]{2}$/.test(t));
    return bad ? `"${bad}" is not a valid ISO alpha-2 code.` : null;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get('id');
      if (id) this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    if (!this.form.dirty && !this.configDirty()) return;
    if (this.zonesError()) return;

    const raw = this.form.getRawValue();
    const body: UpdateCarrierRequest = {};
    const controls = this.form.controls;
    if (controls.name.dirty) body.name = raw.name;
    if (controls.services.dirty) body.services = this.parseList(raw.services);
    if (controls.zones.dirty) body.zones = this.parseList(raw.zones) as [string, ...string[]];
    if (controls.sortOrder.dirty) body.sortOrder = Number(raw.sortOrder);
    if (controls.isActive.dirty) body.isActive = raw.isActive;
    if (this.configDirty()) body.config = this.configDiff();

    this.busy.set(true);
    this.action.set('save');
    this.error.set(null);
    this.service.update(this.current()!.id, body).subscribe({
      next: (c) => {
        this.current.set(c);
        this.pendingConfig.set({ ...(c.config as Record<string, unknown>) });
        this.configDirty.set(false);
        this.seedForm(c);
        this.busy.set(false);
        this.action.set(null);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => this.failAction(err, 'Could not save carrier.'),
    });
  }

  async confirmDelete(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this carrier?',
      body: `"${carrierLabel(current, this.authStore.locale(), this.storeSettings.defaultLocale())}" will stop appearing at checkout. The record is soft-deleted so the code stays reserved.`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;

    this.busy.set(true);
    this.action.set('delete');
    this.error.set(null);
    this.service.delete(current.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        void this.router.navigate(['/shipping/carriers']);
      },
      error: (err: unknown) => this.failAction(err, 'Could not delete carrier.'),
    });
  }

  private parseList(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.length === 2 ? t.toUpperCase() : t));
  }

  /** Diff the pending config against the loaded one — removed keys PATCH as null. */
  private configDiff(): Record<string, unknown> {
    const stored = (this.current()?.config as Record<string, unknown>) ?? {};
    const pending = this.pendingConfig();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pending)) out[k] = v;
    for (const k of Object.keys(stored)) {
      if (!(k in pending)) out[k] = null;
    }
    return out;
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (c) => {
          this.current.set(c);
          this.pendingConfig.set({ ...(c.config as Record<string, unknown>) });
          this.configDirty.set(false);
          this.seedForm(c);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(c: Carrier): void {
    const asTranslatable = (v: unknown): TranslatableValue => {
      if (v && typeof v === 'object' && 'default' in (v as object)) {
        return v as TranslatableValue;
      }
      return { default: '' };
    };
    this.form.reset(
      {
        name: asTranslatable(c.name),
        services: (c.services ?? []).join(', '),
        zones: (c.zones ?? []).join(', '),
        sortOrder: c.sortOrder,
        isActive: c.isActive,
      },
      { emitEvent: false },
    );
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
  }

  private formatError(err: unknown, fallback = 'Could not load carrier.'): string {
    if (err instanceof ApiNotFoundError) return 'Carrier not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to modify carriers.';
    if (err instanceof ApiConflictError) return 'Code conflict — pick a different code.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
