import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { LocaleService } from '../../locale.service';
import { ProductCardComponent, type ProductCardData } from '../../ui/product-card.component';

@Component({
  selector: 'product-related-products',
  standalone: true,
  imports: [ProductCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length > 0) {
      <section
        class="related"
        [attr.aria-labelledby]="titleId"
        data-testid="product-related-products"
      >
        <h2 [id]="titleId" class="title">{{ strings().product.related.title }}</h2>
        <ul class="grid" role="list">
          @for (item of items(); track item.slug) {
            <li class="cell">
              <app-product-card [data]="item" />
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .related {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: clamp(0.75rem, 2vw, 1rem);
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (min-width: 768px) {
        .grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      .cell {
        display: block;
      }
    `,
  ],
})
export class RelatedProductsComponent {
  readonly items = input<ProductCardData[]>([]);

  protected readonly titleId = `product-related-${++relatedProductsId}`;

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());
}

let relatedProductsId = 0;
