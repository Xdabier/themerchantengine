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
import { IconComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import { ArrowLeft } from 'lucide-angular';
import { AuditLogService, type AuditLogEntry, type ListAuditLogQuery } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import {
  actionLabel,
  actorLabel,
  actorName,
  diffEntry,
  formatDiffValue,
  resourceLabel,
  type DiffRow,
} from './audit-logs.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/**
 * `/audit-logs/:entityType/:entityId` — chronological drill-down view
 * of every audit entry touching a single resource. Sibling to the list
 * page: reuses the same diff utility + actor helper so a reviewer who
 * knows the list view already knows this one.
 */
@Component({
  selector: 'app-audit-log-entity-page',
  standalone: true,
  imports: [IconComponent, RouterLink, SkeletonComponent, AdminDatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="audit-log-entity-page">
      <header>
        <a
          routerLink="/audit-logs"
          class="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="audit-log-entity-back"
        >
          <app-icon [name]="ArrowLeft" [size]="16" />
          <span>Back to audit log</span>
        </a>
        <p class="mt-4 text-xs tracking-widest uppercase text-ink-muted">Security</p>
        <h1
          class="mt-2 text-4xl md:text-5xl font-bold tracking-tight break-all"
          data-testid="audit-log-entity-heading"
        >
          {{ resourceLabel(entityType()) }}
          <span class="font-mono text-ink-muted text-2xl md:text-3xl" aria-hidden="true">
            {{ truncateId(entityId()) }}
          </span>
          <span class="sr-only">{{ entityId() }}</span>
        </h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Every recorded change to this resource, newest first. Expand a row for the before/after
          diff.
        </p>
      </header>

      <div data-testid="audit-log-entity-error">
        @if (error()) {
          <p role="alert" class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Audit entries for
              {{
                resourceLabel(entityType())
              }}
              {{
                entityId()
              }}
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-10"
                >
                  <span class="sr-only">Expand</span>
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Time
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Actor
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Action
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Correlation
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    colspan="5"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="audit-log-entity-empty"
                  >
                    No audit entries for this entity.
                  </td>
                </tr>
              } @else {
                @for (row of rows(); track row.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'audit-entity-row-' + row.id"
                  >
                    <td class="px-4 py-3">
                      <button
                        type="button"
                        class="w-8 h-8 inline-flex items-center justify-center text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                        [attr.aria-expanded]="isExpanded(row.id)"
                        [attr.aria-controls]="'audit-entity-diff-' + row.id"
                        [attr.aria-label]="
                          (isExpanded(row.id) ? 'Collapse ' : 'Expand ') + 'audit entry'
                        "
                        (click)="toggleRow(row.id)"
                        [attr.data-testid]="'audit-entity-toggle-' + row.id"
                      >
                        <span aria-hidden="true">{{ isExpanded(row.id) ? '▾' : '▸' }}</span>
                      </button>
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink">
                      {{ row.createdAt | adminDate: 'forensic' }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted" [title]="row.userId ?? ''">
                      {{ actorName(row) }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink">
                      {{ actionLabel(row.action) }}
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink-muted">
                      @if (row.correlationId) {
                        <span aria-hidden="true">{{ truncateId(row.correlationId) }}</span>
                        <span class="sr-only">{{ row.correlationId }}</span>
                      } @else {
                        —
                      }
                    </td>
                  </tr>
                  @if (isExpanded(row.id)) {
                    <tr
                      [id]="'audit-entity-diff-' + row.id"
                      class="border-b border-line bg-surface-elevated"
                      [attr.data-testid]="'audit-entity-diff-' + row.id"
                    >
                      <td></td>
                      <td colspan="4" class="px-4 py-3">
                        @if (diffRows(row).length === 0) {
                          <p class="text-xs text-ink-muted">
                            No field-level diff available for this entry.
                          </p>
                        } @else {
                          <ul class="flex flex-col gap-1" role="list">
                            @for (d of diffRows(row); track d.key) {
                              <li class="grid grid-cols-[1fr_1fr_1fr] gap-3 font-mono text-xs">
                                <span class="text-ink">{{ d.key }}</span>
                                <span class="text-ink border-l-2 border-status-error pl-2">
                                  <span class="sr-only">Before: </span>
                                  {{ format(d.before) }}
                                </span>
                                <span class="text-ink border-l-2 border-status-success pl-2">
                                  <span class="sr-only">After: </span>
                                  {{ format(d.after) }}
                                </span>
                              </li>
                            }
                          </ul>
                        }
                      </td>
                    </tr>
                  }
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
        testIdPrefix="audit-log-entity"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class AuditLogEntityPage implements OnInit, OnDestroy {
  private readonly service = inject(AuditLogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly AuditLogEntry[]>([]);
  readonly total = signal(0);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly ArrowLeft = ArrowLeft;

  readonly params = toSignal(this.route.paramMap, { initialValue: null });
  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly entityType = computed(() => this.params()?.get('entityType') ?? '');
  readonly entityId = computed(() => this.params()?.get('entityId') ?? '');
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly actionLabel = actionLabel;
  protected readonly actor = actorLabel;
  protected readonly actorName = actorName;
  protected readonly format = formatDiffValue;
  protected readonly resourceLabel = resourceLabel;

  truncateId(id: string): string {
    if (!id) return '';
    return id.length > 18 ? id.slice(0, 18) + '…' : id;
  }

  diffRows(row: AuditLogEntry): DiffRow[] {
    return diffEntry(row);
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
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

  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  toggleRow(id: string): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
  }

  private fetch(): void {
    const entityType = this.entityType();
    const entityId = this.entityId();
    if (!entityType || !entityId) {
      this.loading.set(false);
      return;
    }

    const query: ListAuditLogQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };

    this.loading.set(true);
    this.error.set(null);
    this.service
      .listByEntity(entityType, entityId, query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.rows.set([]);
          this.total.set(0);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view the audit log.';
    if (err instanceof ApiNotFoundError) return 'No audit entries exist for this entity.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load audit log.';
  }
}
