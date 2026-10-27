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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import {
  MERCHANDISING_RULE_TYPES,
  SearchAdminService,
  type CreateMerchandisingRuleRequest,
  type MerchandisingRule,
  type MerchandisingRuleType,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { TranslatablePipe } from '../../shared/pipes/translatable.pipe';
import { merchandisingTypeBadge } from './search-ops.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

type CreateStatus = { tone: 'success' | 'error'; message: string } | null;

function ruleGroupValidator(group: AbstractControl): ValidationErrors | null {
  const type = group.get('type')?.value as MerchandisingRuleType | null;
  const productId = (group.get('productId')?.value as string | null) ?? '';
  const position = group.get('position')?.value as number | null;
  if (!type) return { typeRequired: true };
  if ((['BOOST', 'BURY', 'PIN'] as const).includes(type as never) && !productId.trim()) {
    return { productIdRequired: true };
  }
  if (type === 'PIN' && (position === null || position === undefined)) {
    return { positionRequired: true };
  }
  return null;
}

@Component({
  selector: 'app-merchandising-list-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatablePipe,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="merchandising-list-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/search-ops" class="hover:underline">Search ops</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Merchandising</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Merchandising rules</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Boost, bury, pin, or redirect products in the search ranking pipeline.
        </p>
      </header>

      @if (canManage()) {
        <form
          [formGroup]="form"
          (ngSubmit)="submitCreate()"
          class="border border-line bg-surface p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
          aria-labelledby="rule-create-title"
          novalidate
        >
          <header class="md:col-span-2">
            <h2 id="rule-create-title" class="text-lg font-bold tracking-tight">
              Add merchandising rule
            </h2>
            <p class="mt-1 text-xs text-ink-muted">
              BOOST / BURY / PIN require a product. PIN also requires a position. Blank query
              applies to every search.
            </p>
          </header>

          <app-form-field
            label="Type"
            [fieldId]="typeId"
            hint="Ranking behaviour."
            [required]="true"
          >
            <select
              [id]="typeId"
              formControlName="type"
              required
              class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="rule-type-select"
            >
              @for (option of ruleTypes; track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </app-form-field>

          <app-form-field
            label="Query"
            [fieldId]="queryId"
            hint="Leave blank to apply to every query."
          >
            <app-input
              [id]="queryId"
              formControlName="query"
              autocomplete="off"
              data-testid="rule-query"
            />
          </app-form-field>

          <app-form-field
            label="Product ID"
            [fieldId]="productId"
            hint="Required for BOOST / BURY / PIN."
            [required]="requiresProduct()"
          >
            <app-input
              [id]="productId"
              formControlName="productId"
              autocomplete="off"
              data-testid="rule-productId"
            />
          </app-form-field>

          @if (form.controls.type.value === 'PIN') {
            <app-form-field
              label="Position"
              [fieldId]="positionId"
              hint="Zero-indexed rank within the result list."
              [required]="true"
            >
              <app-input
                [id]="positionId"
                formControlName="position"
                type="number"
                autocomplete="off"
                data-testid="rule-position"
              />
            </app-form-field>
          }

          <app-form-field
            label="Priority"
            [fieldId]="priorityId"
            hint="Higher priority overrides lower. Negative values bury."
          >
            <app-input
              [id]="priorityId"
              formControlName="priority"
              type="number"
              autocomplete="off"
              data-testid="rule-priority"
            />
          </app-form-field>

          <div class="md:col-span-2 flex items-center justify-end gap-3">
            <app-button
              variant="secondary"
              (clicked)="resetDraft()"
              [disabled]="creating() || form.pristine"
              data-testid="rule-create-reset"
            >
              Clear
            </app-button>
            <app-button
              type="submit"
              [disabled]="form.invalid || creating()"
              [loading]="creating()"
              data-testid="rule-create-submit"
            >
              Create rule
            </app-button>
          </div>

          <p
            class="md:col-span-2 text-xs"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="rule-create-status"
            [class.border]="!!status()"
            [class.p-3]="!!status()"
            [class.border-status-success]="status()?.tone === 'success'"
            [class.border-status-error]="status()?.tone === 'error'"
            [class.text-ink]="!!status()"
          >
            {{ status()?.message ?? '' }}
          </p>
        </form>
      }

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="merchandising-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Merchandising rules
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Type
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Query
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Product
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Position
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Priority
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Status
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Created
                </th>
                @if (canManage()) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-24"
                  >
                    <span class="sr-only">Actions</span>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of skeletonRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of columnSkeleton(); track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="canManage() ? 8 : 7"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="merchandising-empty"
                  >
                    No merchandising rules yet.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'rule-row-' + item.id"
                  >
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="typeBadge(item.type).tone"
                        [ariaLabel]="typeBadge(item.type).label + ' rule type'"
                        >{{ typeBadge(item.type).label }}</app-badge
                      >
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink break-all">
                      {{ item.query ?? '—' }}
                    </td>
                    <td
                      class="px-4 py-3 text-xs text-ink-muted break-all"
                      [title]="item.productId ?? ''"
                    >
                      {{ (item.product?.name | translatable) || item.productId || '—' }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.position ?? '—' }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.priority ?? '—' }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="item.isActive ? 'success' : 'warning'"
                        [ariaLabel]="item.isActive ? 'Active rule' : 'Disabled rule'"
                      >
                        {{ item.isActive ? 'Active' : 'Disabled' }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.createdAt | adminDate }}
                    </td>
                    @if (canManage()) {
                      <td class="px-4 py-3">
                        <app-button
                          variant="ghost"
                          size="sm"
                          [attr.data-testid]="'rule-delete-' + item.id"
                          [disabled]="deletingId() === item.id"
                          [loading]="deletingId() === item.id"
                          (clicked)="confirmDelete(item)"
                        >
                          Delete
                        </app-button>
                      </td>
                    }
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

      <app-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="total()"
        [loading]="loading()"
        testIdPrefix="merchandising"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class MerchandisingListPage implements OnInit, OnDestroy {
  private readonly search = inject(SearchAdminService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly ruleTypes = MERCHANDISING_RULE_TYPES;
  protected readonly typeBadge = merchandisingTypeBadge;

  readonly typeId = 'rule-create-type';
  readonly queryId = 'rule-create-query';
  readonly productId = 'rule-create-productId';
  readonly positionId = 'rule-create-position';
  readonly priorityId = 'rule-create-priority';

  readonly form = this.fb.nonNullable.group(
    {
      type: this.fb.nonNullable.control<MerchandisingRuleType>('BOOST', [Validators.required]),
      query: this.fb.nonNullable.control<string>('', [Validators.maxLength(200)]),
      productId: this.fb.nonNullable.control<string>(''),
      position: this.fb.control<number | null>(null),
      priority: this.fb.control<number | null>(null),
    },
    { validators: [ruleGroupValidator] },
  );

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly MerchandisingRule[]>([]);
  readonly total = signal(0);
  readonly deletingId = signal<string | null>(null);
  readonly creating = signal(false);
  readonly status = signal<CreateStatus>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly canManage = computed(() => this.auth.hasPermission('products:update'));
  readonly columnSkeleton = computed(() =>
    this.canManage() ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6],
  );

  requiresProduct(): boolean {
    const t = this.form.controls.type.value;
    return (['BOOST', 'BURY', 'PIN'] as const).includes(t as never);
  }

  private firstInvalidControlId(): string | null {
    const errors = this.form.errors ?? {};
    if (errors['productIdRequired']) return this.productId;
    if (errors['positionRequired']) return this.positionId;
    if (this.form.controls.type.invalid) return this.typeId;
    if (this.form.controls.query.invalid) return this.queryId;
    return this.typeId;
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  resetDraft(): void {
    this.form.reset({
      type: 'BOOST',
      query: '',
      productId: '',
      position: null,
      priority: null,
    });
    this.status.set(null);
  }

  submitCreate(): void {
    if (this.creating()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      const target = this.firstInvalidControlId();
      if (target) queueMicrotask(() => document.getElementById(target)?.focus());
      return;
    }
    const raw = this.form.getRawValue();
    const payload: CreateMerchandisingRuleRequest = {
      type: raw.type,
      ...(raw.query?.trim() ? { query: raw.query.trim() } : {}),
      ...(raw.productId?.trim() ? { productId: raw.productId.trim() } : {}),
      ...(raw.position !== null && raw.position !== undefined
        ? { position: Number(raw.position) }
        : {}),
      ...(raw.priority !== null && raw.priority !== undefined
        ? { priority: Number(raw.priority) }
        : {}),
    };
    this.creating.set(true);
    this.status.set(null);
    this.search
      .createMerchandisingRule(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.resetDraft();
          this.status.set({ tone: 'success', message: 'Merchandising rule created' });
          this.fetch();
        },
        error: (err: unknown) => {
          this.creating.set(false);
          this.status.set({ tone: 'error', message: this.formatError(err) });
        },
      });
  }

  async confirmDelete(item: MerchandisingRule): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete merchandising rule?',
      body: 'Removes this rule from the search ranking pipeline. Takes effect on the next search.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deletingId.set(item.id);
    this.search
      .deleteMerchandisingRule(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deletingId.set(null);
          this.fetch();
        },
        error: (err: unknown) => {
          this.deletingId.set(null);
          this.error.set(this.formatError(err));
        },
      });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.search
      .listMerchandisingRules({ page: this.page(), pageSize: this.pageSize() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) {
      return 'You do not have permission to manage merchandising rules.';
    }
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load merchandising rules. Please retry.';
  }
}
