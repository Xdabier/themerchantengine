import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { LoadMoreSentinelComponent } from '../../ui/load-more-sentinel.component';
import { ProductCardComponent, type ProductCardData } from '../../ui/product-card.component';
import { SkeletonComponent } from '../../ui/skeleton.component';

export interface ProductGridCardClick {
  slug: string;
  position: number;
  event: MouseEvent;
}

@Component({
  selector: 'catalog-product-grid',
  standalone: true,
  imports: [
    EmptyStateComponent,
    LoadMoreSentinelComponent,
    ProductCardComponent,
    RouterLink,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <ul class="grid skeleton-grid" role="list" data-testid="catalog-grid-loading">
        @for (placeholder of placeholders; track $index) {
          <li class="cell">
            <app-skeleton variant="card" [label]="strings().catalog.loading" />
          </li>
        }
      </ul>
    } @else if (items().length === 0) {
      <app-empty-state
        [heading]="emptyHeading()"
        [body]="emptyBody()"
        data-testid="catalog-grid-empty"
      >
        @if (emptyCtaLabel() && emptyCtaHref()) {
          <a
            empty-cta
            class="empty-cta"
            [routerLink]="emptyCtaHref()"
            data-testid="catalog-grid-empty-cta"
          >
            {{ emptyCtaLabel() }}
          </a>
        }
      </app-empty-state>
    } @else {
      <ul class="grid" role="list" data-testid="catalog-grid" (click)="onGridClick($event)">
        @for (item of items(); track item.slug; let i = $index) {
          <li class="cell" [attr.data-product-slug]="item.slug" [attr.data-product-index]="i">
            <app-product-card [data]="item" />
          </li>
        }
      </ul>
      <app-load-more-sentinel
        [hasMore]="hasMore()"
        [loading]="loadingMore()"
        [loadMoreLabel]="strings().catalog.loadMore"
        [loadingLabel]="strings().catalog.loadingMore"
        (loadMore)="loadMore.emit()"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: clamp(0.75rem, 2vw, 1rem);
        grid-template-columns: repeat(2, minmax(0, 1fr));
        /* Every row as tall as the tallest, not just as tall as its own
           content. The card reserves a fixed slot for the title, the rating
           and the delivery line, but not for the price: app-price wraps,
           and a product with a compare-at price renders four items where one
           without renders two, so it takes an extra line. Rows size
           independently under the default auto value, so two rows could differ by
           the height of that line while the cards inside each row matched.
           Reserving a fixed price height instead needs a per-breakpoint
           worst-case guess, and making the price non-wrapping was measured
           and made the drift worse. */
        grid-auto-rows: 1fr;
      }
      @media (min-width: 768px) {
        .grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @media (min-width: 1024px) {
        .grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      .cell {
        display: flex;
        /* min-inline-size: 0 — without this, the flex item inherits the
           default content-min (image intrinsic width), pushing each cell
           past its 1fr track and breaking the 2-col grid at narrow
           viewports (cards rendered 310 px wide on a 360 px viewport,
           overflowing the page). */
        min-inline-size: 0;
      }
      .cell > app-product-card {
        flex: 1;
        min-inline-size: 0;
      }
      .skeleton-grid app-skeleton {
        block-size: 280px;
        display: block;
      }
      .empty-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 44px;
        padding-inline: 1rem;
        font: inherit;
        font-weight: 500;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
      }
      .empty-cta:hover,
      .empty-cta:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .empty-cta:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
    `,
  ],
})
export class ProductGridComponent {
  readonly items = input<ProductCardData[]>([]);
  readonly loading = input<boolean>(false);
  /** True while the next page is being appended; the existing cards stay rendered. */
  readonly loadingMore = input<boolean>(false);
  /** Drives the "load more" sentinel — when false, the sentinel is hidden and never emits. */
  readonly hasMore = input<boolean>(false);
  /** Optional override for the empty-state heading (used by /search). */
  readonly emptyHeadingOverride = input<string | null>(null);
  /** Optional override for the empty-state body (used by /search). */
  readonly emptyBodyOverride = input<string | null>(null);
  /** Optional empty-state CTA label (renders an `<a>` link below the body). */
  readonly emptyCtaLabel = input<string | null>(null);
  /** Required when `emptyCtaLabel` is set — `routerLink` href (typically `/[locale]`). */
  readonly emptyCtaHref = input<string | null>(null);

  readonly cardClick = output<ProductGridCardClick>();
  readonly loadMore = output<void>();

  protected readonly placeholders = Array.from({ length: 8 });

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());
  protected readonly emptyHeading = computed(
    () => this.emptyHeadingOverride() ?? this.strings().catalog.empty.title,
  );
  protected readonly emptyBody = computed(
    () => this.emptyBodyOverride() ?? this.strings().catalog.empty.body,
  );

  protected onGridClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const cell = target.closest<HTMLElement>('[data-product-slug]');
    if (!cell) return;
    const slug = cell.getAttribute('data-product-slug');
    const indexAttr = cell.getAttribute('data-product-index');
    if (!slug || indexAttr === null) return;
    const position = Number(indexAttr);
    if (Number.isNaN(position)) return;
    this.cardClick.emit({ slug, position, event });
  }
}
