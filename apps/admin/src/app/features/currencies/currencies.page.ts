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
import { CurrenciesService, type CurrenciesResponse, type CurrencyRow } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { CurrencyStore } from '../../core/stores/currency.store';

/**
 * `/currencies` — enable/disable per ISO code + pick the storefront
 * default. Mirrors `/shipping/countries` pattern so operators feel
 * at home: region groups, per-region Enable/Disable shortcuts,
 * default selector constrained to the enabled set (both client-side
 * and server-side via Zod refine).
 */
@Component({
  selector: 'app-currencies-page',
  standalone: true,
  imports: [ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="currencies-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Currencies</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Which currencies the storefront accepts + which one the checkout defaults to when a
          customer has no regional preference.
        </p>
      </header>

      <div role="alert" data-testid="currencies-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="currencies-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 text-xs">Currencies updated.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else {
        <div class="flex flex-col gap-3 max-w-sm">
          <label for="currency-default" class="text-xs tracking-widest uppercase text-ink-muted">
            Default currency
          </label>
          <select
            id="currency-default"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="defaultCode() ?? ''"
            (change)="onDefaultChange($event)"
            data-testid="currency-default-select"
          >
            @for (c of allRows(); track c.code) {
              <option
                [value]="c.code"
                [selected]="c.code === defaultCode()"
                [disabled]="!enabled().has(c.code)"
              >
                {{ c.code }} — {{ c.name }}
              </option>
            }
          </select>
        </div>

        @for (group of grouped(); track group.region) {
          <section
            class="flex flex-col gap-3 border border-line p-4"
            [attr.aria-labelledby]="'region-' + group.region"
            [attr.data-testid]="'currency-region-' + group.region"
          >
            <header class="flex items-center justify-between gap-4 flex-wrap">
              <h2
                [id]="'region-' + group.region"
                class="text-xs tracking-widest uppercase text-ink-muted"
              >
                {{ group.region }}
                <span class="ml-3 tabular-nums text-ink-muted">
                  {{ enabledCountForRegion(group.region) }} / {{ group.rows.length }}
                </span>
              </h2>
              <div class="flex items-center gap-2">
                <app-button
                  variant="ghost"
                  size="sm"
                  [disabled]="busy() || !canManage()"
                  (clicked)="setRegion(group.region, true)"
                  [attr.data-testid]="'currency-region-enable-' + group.region"
                >
                  Enable all
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  [disabled]="busy() || !canManage()"
                  (clicked)="setRegion(group.region, false)"
                  [attr.data-testid]="'currency-region-disable-' + group.region"
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
                      (change)="toggleCurrency(row.code, $event)"
                      [attr.data-testid]="'currency-toggle-' + row.code"
                    />
                    <span class="font-mono text-xs">{{ row.code }}</span>
                    <span>{{ row.name }}</span>
                    <span class="text-ink-muted text-xs ml-auto">{{ row.symbol }}</span>
                  </label>
                  @if (row.code === defaultCode()) {
                    <span
                      class="text-xs tracking-widest uppercase text-status-info"
                      aria-hidden="true"
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
          <p class="text-xs text-ink-muted">
            <span class="font-mono tabular-nums">{{ enabled().size }}</span>
            enabled · default
            <span class="font-mono">{{ defaultCode() ?? '—' }}</span>
          </p>
          <div class="flex items-center gap-3">
            <app-button
              type="button"
              variant="ghost"
              size="sm"
              [disabled]="busy() || !dirty()"
              (clicked)="revert()"
              data-testid="currency-revert"
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
              data-testid="currency-save"
            >
              Save changes
            </app-button>
          </div>
        </footer>
      }
    </section>
  `,
})
export class CurrenciesPage implements OnInit, OnDestroy {
  private readonly service = inject(CurrenciesService);
  private readonly authStore = inject(AuthStore);
  private readonly currencyStore = inject(CurrencyStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly allRows = signal<readonly CurrencyRow[]>([]);
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
    const map = new Map<string, CurrencyRow[]>();
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

  toggleCurrency(code: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.enabled());
    if (checked) next.add(code);
    else {
      next.delete(code);
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
    this.defaultCode.set((event.target as HTMLSelectElement).value || null);
  }

  revert(): void {
    this.enabled.set(new Set(this.initialEnabled));
    this.defaultCode.set(this.initialDefault);
  }

  save(): void {
    if (this.busy() || !this.dirty()) return;
    const enabled = [...this.enabled()];
    if (enabled.length === 0) {
      this.error.set('Enable at least one currency before saving.');
      return;
    }
    const def = this.defaultCode();
    if (def && !enabled.includes(def)) {
      this.error.set('Default currency must be in the enabled list.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.service.update({ enabled, ...(def ? { defaultCode: def } : {}) }).subscribe({
      next: (res) => {
        this.applyResponse(res);
        // This is the one editor for the store currency, so every other screen's
        // money formatting depends on re-reading it here.
        this.currencyStore.refresh();
        this.busy.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save currencies.'));
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

  private applyResponse(res: CurrenciesResponse): void {
    this.allRows.set(res.data);
    const enabledSet = new Set(res.data.filter((r) => r.enabled).map((r) => r.code));
    this.enabled.set(enabledSet);
    this.initialEnabled = new Set(enabledSet);
    this.defaultCode.set(res.defaultCode);
    this.initialDefault = res.defaultCode;
  }

  private formatError(err: unknown, fallback = 'Could not load currencies.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage currencies.';
    if (err instanceof ApiNotFoundError) return 'Currencies not found.';
    if (err instanceof ApiValidationError && err.message) return err.message;
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
