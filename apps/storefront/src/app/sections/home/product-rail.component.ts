import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { ProductSummary } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { ProductCardComponent } from '../../ui/product-card.component';
import { SectionHeaderComponent } from './section-header.component';
import { toCardData } from './to-card-data';
import { StoreConfigService } from '../../services/store-config.service';

/**
 * Reusable product rail used by the home page Just Arrived (horizontal
 * scroll), Popular (responsive grid), and Thematic rows (responsive grid).
 *
 * `variant`:
 *  - `scroll` — horizontal-overflow rail with scroll-snap. User-driven scroll
 *    only (agent_docs/storefront/brand-tokens.md: no auto-rotating carousels).
 *  - `grid` — responsive grid (2-up `<sm`, 3-up `sm`, 4-up `lg`, 5-up `xl`).
 */
@Component({
  selector: 'app-product-rail',
  standalone: true,
  imports: [ProductCardComponent, SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" [attr.aria-labelledby]="headingId()" [attr.data-testid]="testId()">
      <app-section-header [title]="title()" [eyebrow]="eyebrow()" [headingId]="headingId()" />
      @if (cards().length > 0) {
        @if (variant() === 'scroll') {
          <div
            class="rail"
            [attr.aria-label]="strings().home.horizontalScroll.label + ', ' + title()"
            tabindex="0"
          >
            @for (card of cards(); track card.slug) {
              <div class="rail-cell">
                <app-product-card [data]="card" />
              </div>
            }
          </div>
        } @else {
          <ul class="grid" role="list">
            @for (card of cards(); track card.slug) {
              <li class="grid-cell">
                <app-product-card [data]="card" />
              </li>
            }
          </ul>
        }
      } @else {
        <p class="empty" role="status" aria-live="polite" [attr.data-testid]="testId() + '-empty'">
          {{ strings().home.empty.products }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .rail {
        display: flex;
        gap: 1rem;
        overflow-x: auto;
        overflow-y: hidden;
        scroll-snap-type: inline mandatory;
        padding-block-end: 0.75rem;
        scrollbar-color: var(--brand-border-strong) transparent;
      }
      .rail:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 4px;
        border-radius: var(--brand-radius-md);
      }
      .rail-cell {
        flex: 0 0 70%;
        max-inline-size: 280px;
        scroll-snap-align: start;
      }
      .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }
      .grid-cell {
        display: flex;
      }
      .grid-cell > app-product-card {
        flex: 1;
      }
      .empty {
        margin: 0;
        padding-block: 1.5rem;
        padding-inline: 1rem;
        color: var(--brand-text-muted);
        background-color: var(--brand-surface);
        border: 1px dashed var(--brand-border-strong);
        border-radius: var(--brand-radius-lg);
      }

      @media (min-width: 640px) {
        .rail-cell {
          flex-basis: 45%;
        }
        .grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @media (min-width: 1024px) {
        .rail-cell {
          flex-basis: 30%;
        }
        .grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      @media (min-width: 1280px) {
        .rail-cell {
          flex-basis: 22%;
        }
        .grid {
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }
      }
    `,
  ],
})
export class ProductRailComponent {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);

  readonly title = input.required<string>();
  readonly eyebrow = input<string | null>(null);
  readonly products = input<ProductSummary[]>([]);
  readonly variant = input<'scroll' | 'grid'>('grid');
  readonly testId = input.required<string>();
  readonly idSuffix = input.required<string>();

  protected readonly strings = this.localeService.strings;
  protected readonly locale = this.localeService.locale;

  protected readonly headingId = computed(() => `home-rail-${this.idSuffix()}`);

  protected readonly cards = computed(() =>
    this.products().map((p) =>
      toCardData(
        p,
        this.locale(),
        this.strings().home.deliveryEstimate,
        this.storeConfig.currencyCode(),
      ),
    ),
  );
}
