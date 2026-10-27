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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent, openConfirmDialog } from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { ShippingService, type ShippingMethod } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  METHOD_TYPE_LABELS,
  freeAboveSummary,
  methodPriceSummary,
  methodTypeBadgeTone,
  translatableDefault,
} from './shipping.utils';
import { CurrencyStore } from '../../core/stores/currency.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

@Component({
  selector: 'app-shipping-method-detail-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, AdminDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="shipping-method-detail-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/shipping/methods" class="hover:underline">Shipping methods</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">{{ methodName() }}</span>
      </nav>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="method-detail-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      @if (loading()) {
        <app-skeleton height="20rem" />
      } @else if (method()) {
        <header class="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
              {{ methodName() }}
            </h1>
          </div>
          <div class="flex items-center gap-3">
            @if (canUpdate()) {
              <a
                [routerLink]="['/shipping/methods', method()!.id, 'edit']"
                class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
                data-testid="method-edit"
              >
                Edit
              </a>
            }
            @if (canDelete()) {
              <app-button
                variant="destructive"
                (clicked)="confirmDisable()"
                [loading]="deleting()"
                data-testid="method-disable"
              >
                Disable method
              </app-button>
            }
          </div>
        </header>

        <dl class="grid gap-6 md:grid-cols-2 border border-line bg-surface p-6">
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Type</dt>
            <dd class="mt-2">
              <app-badge
                [tone]="methodTypeBadgeTone(method()!.type)"
                [ariaLabel]="typeLabels[method()!.type]"
              >
                {{ typeLabels[method()!.type] }}
              </app-badge>
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Zone</dt>
            <dd class="mt-2 text-sm text-ink" data-testid="method-zone">
              {{ zoneName() }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Price</dt>
            <dd class="mt-2 text-sm text-ink tabular-nums">
              {{ methodPriceSummary(method()!, storeCurrency()) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Free above</dt>
            <dd class="mt-2 text-sm text-ink tabular-nums">
              {{ freeAboveSummary(method()!.freeAbove, storeCurrency()) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Sort order</dt>
            <dd class="mt-2 text-sm text-ink tabular-nums">{{ method()!.sortOrder }}</dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Status</dt>
            <dd class="mt-2">
              <div class="flex items-center gap-2 flex-wrap">
                <app-badge
                  [tone]="method()!.isActive ? 'success' : 'warning'"
                  [ariaLabel]="method()!.isActive ? 'Active method' : 'Disabled method'"
                >
                  {{ method()!.isActive ? 'Active' : 'Disabled' }}
                </app-badge>
                @if (method()!.isDefault) {
                  <app-badge tone="info" [ariaLabel]="'Default method'"> Default </app-badge>
                }
              </div>
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Updated</dt>
            <dd class="mt-2 text-sm text-ink tabular-nums">
              {{ method()!.updatedAt | adminDate }}
            </dd>
          </div>
        </dl>
      }
    </section>
  `,
})
export class ShippingMethodDetailPage implements OnInit, OnDestroy {
  private readonly shipping = inject(ShippingService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();
  private readonly currencyStore = inject(CurrencyStore);
  protected readonly storeCurrency = this.currencyStore.config;
  protected readonly methodPriceSummary = methodPriceSummary;
  protected readonly freeAboveSummary = freeAboveSummary;
  protected readonly methodTypeBadgeTone = methodTypeBadgeTone;
  protected readonly typeLabels = METHOD_TYPE_LABELS;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly method = signal<ShippingMethod | null>(null);
  readonly deleting = signal(false);

  readonly canUpdate = computed(() => this.auth.hasPermission('shipping:update'));
  readonly canDelete = computed(() => this.auth.hasPermission('shipping:delete'));

  methodName(): string {
    return translatableDefault(this.method()?.name ?? null) || '(untitled)';
  }

  /** The joined zone name the list response already carries; no extra fetch. */
  zoneName(): string {
    return translatableDefault(this.method()?.zone?.name ?? null) || '—';
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      this.error.set('Method not found.');
      return;
    }
    this.shipping
      .listMethods({ pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const match = res.data.find((m) => m.id === id);
          if (!match) {
            this.loading.set(false);
            this.error.set('Method not found.');
            return;
          }
          this.method.set(match);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async confirmDisable(): Promise<void> {
    const m = this.method();
    if (!m) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Disable this shipping method?',
      body: 'Disabling hides this method from new orders but preserves existing order snapshots.',
      confirmLabel: 'Disable',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deleting.set(true);
    this.shipping
      .deleteMethod(m.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          void this.router.navigate(['/shipping/methods']);
        },
        error: (err: unknown) => {
          this.deleting.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) {
      return 'You do not have permission to manage shipping methods.';
    }
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load the method. Please retry.';
  }
}
