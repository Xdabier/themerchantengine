import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ButtonComponent, SkeletonComponent } from '@admin-ui';
import { CountriesService, type CountriesResponse, type CountryRow } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';

/**
 * `/shipping/countries` — bulk enable/disable + default selector.
 *
 * Rows are grouped by region for readability. Bulk "Enable region"
 * and "Disable region" buttons toggle the whole group — useful for
 * rolling out to GCC or disabling Americas while shipping stabilises.
 * Default selector is constrained to the enabled set both client-side
 * (disabled <option>s) and server-side (Zod refine + service guard).
 */
@Component({
  selector: 'app-countries-page',
  standalone: true,
  imports: [ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="countries-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Countries</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Pick the countries the storefront will ship to. The default country is the one selected
          first at checkout — it must be in the enabled list.
        </p>
      </header>

      <div role="alert" aria-atomic="true" data-testid="countries-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" data-testid="countries-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 text-xs">Countries updated.</p>
        }
      </div>

      @if (loading()) {
        <div
          role="status"
          aria-label="Loading countries"
          [attr.aria-busy]="loading() ? 'true' : null"
          class="flex flex-col gap-4"
        >
          <span class="sr-only">Loading countries…</span>
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else {
        <div class="flex flex-col gap-3 max-w-sm">
          <label for="country-default" class="text-xs tracking-widest uppercase text-ink-muted">
            Default country
          </label>
          <select
            id="country-default"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="defaultCode() ?? ''"
            (change)="onDefaultChange($event)"
            data-testid="country-default-select"
          >
            @for (c of allRows(); track c.code) {
              <option
                [value]="c.code"
                [selected]="c.code === defaultCode()"
                [disabled]="!enabled().has(c.code)"
              >
                {{ c.name }} ({{ c.code }})
              </option>
            }
          </select>
        </div>

        @for (group of grouped(); track group.region) {
          <section
            class="flex flex-col gap-3 border border-line p-4"
            [attr.aria-labelledby]="'region-' + group.region"
            [attr.data-testid]="'country-region-' + group.region"
          >
            <header class="flex items-center justify-between gap-4 flex-wrap">
              <h2
                [id]="'region-' + group.region"
                class="text-xs tracking-widest uppercase text-ink-muted"
              >
                {{ group.region }}
                <span class="ml-3 font-mono tabular-nums text-ink-muted">
                  {{ enabledCountForRegion(group.region) }} / {{ group.rows.length }}
                </span>
              </h2>
              <div class="flex items-center gap-2">
                <app-button
                  variant="ghost"
                  size="sm"
                  [disabled]="busy() || !canManage()"
                  [ariaLabel]="'Enable all countries in ' + group.region"
                  (clicked)="setRegion(group.region, true)"
                  [attr.data-testid]="'country-region-enable-' + group.region"
                >
                  Enable all
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  [disabled]="busy() || !canManage()"
                  [ariaLabel]="'Disable all countries in ' + group.region"
                  (clicked)="setRegion(group.region, false)"
                  [attr.data-testid]="'country-region-disable-' + group.region"
                >
                  Disable all
                </app-button>
              </div>
            </header>
            <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="list">
              @for (row of group.rows; track row.code) {
                <li class="flex items-center gap-3">
                  <label class="flex items-center gap-3 text-sm flex-1 min-w-0">
                    <input
                      type="checkbox"
                      class="h-4 w-4 accent-ink"
                      [checked]="enabled().has(row.code)"
                      [disabled]="!canManage()"
                      [attr.aria-label]="row.name + ' (' + row.code + ')'"
                      (change)="toggleCountry(row.code, $event)"
                      [attr.data-testid]="'country-toggle-' + row.code"
                    />
                    <span>{{ row.name }}</span>
                    <span class="text-ink-muted text-xs font-mono tabular-nums ml-auto">{{
                      row.code
                    }}</span>
                  </label>
                  @if (row.code === defaultCode()) {
                    <span
                      aria-hidden="true"
                      class="text-xs tracking-widest uppercase text-status-info"
                    >
                      Default
                    </span>
                  }
                </li>
              }
            </ul>
          </section>
        }

        <footer
          class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
        >
          <p class="text-xs text-ink-muted" role="status" aria-live="polite" aria-atomic="true">
            <span class="font-mono tabular-nums">{{ enabled().size }}</span> enabled · default
            <span class="font-mono tabular-nums">{{ defaultCode() ?? '—' }}</span>
          </p>
          <div class="flex items-center gap-3">
            <app-button
              type="button"
              variant="ghost"
              size="sm"
              [disabled]="busy() || !dirty()"
              (clicked)="revert()"
              data-testid="country-revert"
            >
              Revert
            </app-button>
            <app-button
              type="button"
              variant="primary"
              size="md"
              [disabled]="busy() || !dirty() || !canManage() || enabled().size === 0"
              [loading]="busy()"
              (clicked)="save()"
              data-testid="country-save"
            >
              Save changes
            </app-button>
          </div>
        </footer>
      }
    </section>
  `,
})
export class CountriesPage implements OnInit, OnDestroy {
  private readonly service = inject(CountriesService);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly allRows = signal<readonly CountryRow[]>([]);
  readonly enabled = signal<ReadonlySet<string>>(new Set());
  readonly defaultCode = signal<string | null>(null);

  private initialEnabled: ReadonlySet<string> = new Set();
  private initialDefault: string | null = null;

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly dirty = computed(() => {
    const e = this.enabled();
    if (e.size !== this.initialEnabled.size) return true;
    for (const v of e) if (!this.initialEnabled.has(v)) return true;
    return this.defaultCode() !== this.initialDefault;
  });

  readonly grouped = computed(() => {
    const map = new Map<string, CountryRow[]>();
    for (const row of this.allRows()) {
      const list = map.get(row.region) ?? [];
      list.push(row);
      map.set(row.region, list);
    }
    return [...map.entries()].map(([region, rows]) => ({ region, rows }));
  });

  enabledCountForRegion(region: string): number {
    return this.allRows().filter((r) => r.region === region && this.enabled().has(r.code)).length;
  }

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleCountry(code: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.enabled());
    if (checked) next.add(code);
    else {
      next.delete(code);
      // If we just disabled the default, clear the default.
      if (this.defaultCode() === code) this.defaultCode.set(null);
    }
    this.enabled.set(next);
  }

  setRegion(region: string, enabled: boolean): void {
    const codes = this.allRows()
      .filter((r) => r.region === region)
      .map((r) => r.code);
    const next = new Set(this.enabled());
    for (const c of codes) {
      if (enabled) next.add(c);
      else next.delete(c);
    }
    this.enabled.set(next);
    if (!enabled && this.defaultCode() && codes.includes(this.defaultCode() as string)) {
      this.defaultCode.set(null);
    }
  }

  onDefaultChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.defaultCode.set(value || null);
  }

  revert(): void {
    this.enabled.set(new Set(this.initialEnabled));
    this.defaultCode.set(this.initialDefault);
  }

  save(): void {
    if (this.busy() || !this.dirty()) return;
    const enabled = [...this.enabled()];
    if (enabled.length === 0) {
      this.error.set('Enable at least one country before saving.');
      return;
    }
    const def = this.defaultCode();
    if (def && !enabled.includes(def)) {
      this.error.set('Default country must be in the enabled list.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.service.update({ enabled, ...(def ? { defaultCode: def } : {}) }).subscribe({
      next: (res) => {
        this.applyResponse(res);
        this.busy.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save countries.'));
      },
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.applyResponse(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private applyResponse(res: CountriesResponse): void {
    this.allRows.set(res.data);
    const enabledSet = new Set(res.data.filter((r) => r.enabled).map((r) => r.code));
    this.enabled.set(enabledSet);
    this.initialEnabled = new Set(enabledSet);
    this.defaultCode.set(res.defaultCode);
    this.initialDefault = res.defaultCode;
  }

  private formatError(err: unknown, fallback = 'Could not load countries.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage countries.';
    if (err instanceof ApiNotFoundError) return 'Countries not found.';
    if (err instanceof ApiValidationError && err.message) return err.message;
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
