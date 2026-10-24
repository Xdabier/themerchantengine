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
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  InputComponent,
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { SearchAdminService, type SynonymGroup } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

type CreateStatus = { tone: 'success' | 'error'; message: string } | null;

@Component({
  selector: 'app-synonyms-list-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="synonyms-list-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/search-ops" class="hover:underline">Search ops</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Synonyms</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Synonyms</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Groups of interchangeable terms. A query for any one term matches documents containing any
          other in the group.
        </p>
      </header>

      @if (canManage()) {
        <form
          class="border border-line bg-surface p-6 flex flex-col gap-4"
          (submit)="$event.preventDefault(); submitCreate()"
          novalidate
          aria-labelledby="synonym-create-title"
        >
          <header>
            <h2 id="synonym-create-title" class="text-lg font-bold tracking-tight">
              Add synonym group
            </h2>
            <p class="mt-1 text-xs text-ink-muted">
              Press Enter or comma to commit a term. Minimum two terms.
            </p>
          </header>
          <div class="flex flex-wrap items-center gap-2" data-testid="synonym-terms-chips">
            @for (term of draftTerms(); track term; let idx = $index) {
              <span class="inline-flex items-center gap-2 border border-line pl-3 text-xs text-ink">
                {{ term }}
                <button
                  type="button"
                  (click)="removeTerm(idx)"
                  class="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  [attr.aria-label]="'Remove ' + term"
                >
                  ×
                </button>
              </span>
            }
            <app-input
              [formControl]="termInput"
              placeholder="Add a term"
              autocomplete="off"
              (keydown)="onTermKeydown($event)"
              data-testid="synonym-terms-input"
              [ariaLabel]="'Add a term'"
            />
          </div>
          <div class="flex items-center justify-end gap-3">
            <app-button
              variant="secondary"
              (clicked)="resetDraft()"
              [disabled]="creating() || (draftTerms().length === 0 && !termInput.value)"
              data-testid="synonym-create-reset"
            >
              Clear
            </app-button>
            <app-button
              type="submit"
              [disabled]="draftTerms().length < 2 || creating()"
              [loading]="creating()"
              data-testid="synonym-create-submit"
            >
              Create synonym group
            </app-button>
          </div>
          <p
            class="text-xs"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="synonym-create-status"
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
        data-testid="synonyms-error"
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
              Synonym groups
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Terms
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
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Updated
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
                    [attr.colspan]="canManage() ? 5 : 4"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="synonyms-empty"
                  >
                    No synonym groups yet.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'synonym-row-' + item.id"
                  >
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap gap-1.5">
                        @for (term of termsPreview(item.terms); track term) {
                          <app-badge tone="neutral">
                            <span class="text-xs">{{ term }}</span>
                          </app-badge>
                        }
                        @if (item.terms.length > 6) {
                          <app-badge tone="neutral">
                            <span class="text-xs">+{{ item.terms.length - 6 }} more</span>
                          </app-badge>
                        }
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="item.isActive ? 'success' : 'warning'"
                        [ariaLabel]="item.isActive ? 'Active group' : 'Disabled group'"
                      >
                        {{ item.isActive ? 'Active' : 'Disabled' }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.createdAt | adminDate }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.updatedAt | adminDate }}
                    </td>
                    @if (canManage()) {
                      <td class="px-4 py-3">
                        <app-button
                          variant="ghost"
                          size="sm"
                          [attr.data-testid]="'synonym-delete-' + item.id"
                          [disabled]="deletingId() === item.id"
                          [loading]="deletingId() === item.id"
                          (clicked)="confirmDelete(item)"
                        >
                          <span data-testid="synonym-delete">Delete</span>
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
        testIdPrefix="synonyms"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class SynonymsListPage implements OnInit, OnDestroy {
  private readonly search = inject(SearchAdminService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly SynonymGroup[]>([]);
  readonly total = signal(0);
  readonly deletingId = signal<string | null>(null);
  readonly creating = signal(false);
  readonly status = signal<CreateStatus>(null);
  readonly draftTerms = signal<readonly string[]>([]);

  readonly termInput = new FormControl<string>('', { nonNullable: true });

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly canManage = computed(() => this.auth.hasPermission('products:update'));
  readonly columnSkeleton = computed(() => (this.canManage() ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]));

  termsPreview(terms: readonly string[]): readonly string[] {
    return terms.slice(0, 6);
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

  commitTerm(): void {
    const raw = this.termInput.value.trim();
    if (!raw) return;
    if (raw.length > 100) {
      this.status.set({ tone: 'error', message: 'Each term must be 100 characters or fewer.' });
      return;
    }
    const next = [...this.draftTerms(), raw];
    this.draftTerms.set(next);
    this.termInput.setValue('');
    this.status.set(null);
  }

  removeTerm(idx: number): void {
    const next = this.draftTerms().filter((_, i) => i !== idx);
    this.draftTerms.set(next);
  }

  onTermKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitTerm();
      return;
    }
    if (event.key === 'Backspace' && !this.termInput.value && this.draftTerms().length > 0) {
      event.preventDefault();
      this.removeTerm(this.draftTerms().length - 1);
    }
  }

  resetDraft(): void {
    this.draftTerms.set([]);
    this.termInput.setValue('');
    this.status.set(null);
  }

  submitCreate(): void {
    if (this.creating()) return;
    // Flush any in-progress term in the input before submitting.
    if (this.termInput.value.trim()) this.commitTerm();
    const terms = this.draftTerms();
    if (terms.length < 2) return;
    this.creating.set(true);
    this.status.set(null);
    this.search
      .createSynonym({ terms: [...terms] })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.resetDraft();
          this.status.set({ tone: 'success', message: 'Synonym group created' });
          this.fetch();
        },
        error: (err: unknown) => {
          this.creating.set(false);
          this.status.set({ tone: 'error', message: this.formatError(err) });
        },
      });
  }

  async confirmDelete(item: SynonymGroup): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete synonym group?',
      body: 'Removes this group from search-query expansion. Existing orders are unaffected.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deletingId.set(item.id);
    this.search
      .deleteSynonym(item.id)
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
      .listSynonyms({ page: this.page(), pageSize: this.pageSize() })
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage synonyms.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load synonyms. Please retry.';
  }
}
