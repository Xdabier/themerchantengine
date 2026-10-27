import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  inject,
  input,
  output,
} from '@angular/core';

import { SkeletonComponent } from './skeleton.component';

/**
 * Catalog "load more" primitive. Rendered beneath an existing product grid.
 *
 * Behaviour contract (constitution §3.10 / §3.11):
 * - On the browser, an `IntersectionObserver` watches a single sentinel `<div>`
 *   with a 200 px `rootMargin` so the next page starts loading slightly before
 *   the visual end of the grid is reached.
 * - Always renders an accessible fallback `<button>` so customers without
 *   `IntersectionObserver` (ancient browsers, JS errors) can advance pages.
 * - Visually-hidden live region announces the loading state on append.
 * - Skeleton row of 8 placeholder cells matches existing card placeholder
 *   dimensions in `product-grid.component.ts:91-94`.
 * - Logical CSS only.
 *
 * Emit semantics: `loadMore` fires on `isIntersecting && hasMore() && !loading()`
 * or on a button click that satisfies the same guards. The owner (catalog
 * page) is responsible for guarding against re-entrancy via its own state
 * (request sequence + `loadingMore` signal).
 */
@Component({
  selector: 'app-load-more-sentinel',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrapper" data-testid="catalog-load-more-sentinel">
      @if (loading()) {
        <ul
          class="skeleton-row"
          role="list"
          data-testid="catalog-load-more-skeleton"
          aria-hidden="true"
        >
          @for (placeholder of placeholders; track $index) {
            <li class="cell">
              <app-skeleton variant="card" [label]="loadingLabel()" />
            </li>
          }
        </ul>
      }

      <div #sentinel class="sentinel" role="presentation" aria-hidden="true"></div>

      <!-- Rendered only while there is a next page. Hidden and disabled left a
           dead control in the DOM of every fully loaded grid (finding C6). -->
      @if (hasMore()) {
        <button
          type="button"
          class="load-more"
          data-testid="catalog-load-more-button"
          [disabled]="loading()"
          (click)="onButtonClick()"
        >
          {{ loadMoreLabel() }}
        </button>
      }

      <div
        class="visually-hidden"
        aria-live="polite"
        [attr.aria-busy]="loading() ? 'true' : 'false'"
      >
        {{ loading() ? loadingLabel() : '' }}
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .wrapper {
        display: flex;
        flex-direction: column;
        gap: clamp(0.75rem, 2vw, 1rem);
        margin-block-start: clamp(1rem, 3vw, 1.5rem);
      }
      .skeleton-row {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: clamp(0.75rem, 2vw, 1rem);
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (min-width: 768px) {
        .skeleton-row {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @media (min-width: 1024px) {
        .skeleton-row {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      .cell {
        display: flex;
        min-inline-size: 0;
      }
      .skeleton-row app-skeleton {
        block-size: 280px;
        display: block;
        flex: 1;
      }
      .sentinel {
        block-size: 1px;
        inline-size: 100%;
      }
      .load-more {
        align-self: center;
        font: inherit;
        font-weight: 500;
        min-block-size: 44px;
        padding-block: 0.625rem;
        padding-inline: 1.5rem;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
        border: 1px solid var(--brand-primary);
        border-radius: var(--brand-radius-md);
        cursor: pointer;
      }
      .load-more:hover:not(:disabled),
      .load-more:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .load-more:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .load-more:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .visually-hidden {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin-block: -1px;
        margin-inline: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class LoadMoreSentinelComponent implements AfterViewInit, OnDestroy {
  readonly hasMore = input<boolean>(false);
  readonly loading = input<boolean>(false);
  readonly loadMoreLabel = input<string>('Load more');
  readonly loadingLabel = input<string>('Loading more');

  readonly loadMore = output<void>();

  @ViewChild('sentinel', { static: false })
  protected sentinelRef?: ElementRef<HTMLElement>;

  protected readonly placeholders = Array.from({ length: 8 });

  private readonly platformId = inject(PLATFORM_ID);
  private observer: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const target = this.sentinelRef?.nativeElement;
    if (!target) return;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!this.hasMore() || this.loading()) continue;
          this.loadMore.emit();
        }
      },
      { rootMargin: '200px 0px', threshold: 0 },
    );
    this.observer.observe(target);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  protected onButtonClick(): void {
    if (!this.hasMore() || this.loading()) return;
    this.loadMore.emit();
  }
}
