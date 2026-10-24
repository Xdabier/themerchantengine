import { ApiForbiddenError } from '@admin-types';
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
import { BadgeComponent, SkeletonComponent } from '@admin-ui';
import { UsersService, type CustomerSegment, type CustomerSegmentSummary } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { segmentLabel, segmentTone } from './users.utils';

/**
 * The cohorts the backend actually computes. VIP and HIGH_VALUE are absent on
 * purpose: no criteria define them anywhere, the counts endpoint never returns
 * them, and their filter can never match, so their cards could only ever show a
 * permanent zero. They come back when a definition exists (plan F, decision D3).
 */
const CANONICAL_ORDER: readonly CustomerSegment[] = [
  'LOYAL',
  'ACTIVE',
  'NEW',
  'AT_RISK',
  'CHURNED',
];

/**
 * `/customers/segments` — dedicated segments view.
 *
 * Lists every backend-known segment with its live member count plus a link
 * through to the main customers list pre-filtered by segment. Segments with
 * no members still render as zero-count cards so operators see the full set.
 */
@Component({
  selector: 'app-customer-segments-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="customer-segments-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/customers"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Customers
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Segments</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">People</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Customer segments</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Lifecycle cohorts from the latest segmentation run. Click a card to open the directory
          scoped to that cohort.
        </p>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="customer-segments-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      @if (loading()) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="status">
          <span class="sr-only">Loading customer segments</span>
          @for (_ of placeholderCards; track $index) {
            <div class="border border-line p-5 flex flex-col gap-3">
              <app-skeleton height="0.75rem" width="40%" />
              <app-skeleton height="2rem" width="30%" />
              <app-skeleton height="0.75rem" width="60%" />
            </div>
          }
        </div>
      } @else {
        <ul
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-label="Customer segments"
        >
          @for (card of cards(); track card.segment) {
            <li
              class="border border-line p-5 flex flex-col gap-3 bg-surface"
              [attr.data-testid]="'segment-card-' + card.segment"
            >
              <div class="flex items-center justify-between gap-3">
                <h2
                  class="text-xs tracking-widest uppercase text-ink"
                  [attr.data-testid]="'segment-heading-' + card.segment"
                >
                  {{ label(card.segment) }}
                </h2>
                <app-badge
                  [tone]="tone(card.segment)"
                  [ariaLabel]="'Segment: ' + label(card.segment)"
                >
                  {{ label(card.segment) }}
                </app-badge>
              </div>
              <p
                class="font-mono tabular-nums text-2xl font-bold text-ink"
                [attr.data-testid]="'segment-count-' + card.segment"
                [attr.aria-label]="card.count + ' customers in ' + label(card.segment)"
              >
                {{ card.count }}
              </p>
              <a
                [routerLink]="['/customers']"
                [queryParams]="{ segment: card.segment }"
                class="mt-1 inline-flex items-center min-h-[44px] text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                [attr.data-testid]="'segment-link-' + card.segment"
                [attr.aria-label]="'View ' + label(card.segment) + ' customers'"
              >
                View customers →
              </a>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class CustomerSegmentsPage implements OnInit, OnDestroy {
  private readonly users = inject(UsersService);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderCards = [0, 1, 2, 3, 4, 5];
  protected readonly label = segmentLabel;
  protected readonly tone = segmentTone;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summaries = signal<readonly CustomerSegmentSummary[]>([]);

  readonly cards = computed<readonly CustomerSegmentSummary[]>(() => {
    const byKey = new Map(this.summaries().map((s) => [s.segment, s.count] as const));
    return CANONICAL_ORDER.map((segment) => ({
      segment,
      count: byKey.get(segment) ?? 0,
    }));
  });

  ngOnInit(): void {
    this.users
      .listCustomerSegments()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.summaries.set(data);
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

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view customers.';
    if (err instanceof Error && err.message) return err.message;
    return 'Could not load customer segments. Please retry.';
  }
}
