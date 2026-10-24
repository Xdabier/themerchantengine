import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { pickTranslation, type WishlistItem } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { APP_ROUTES } from '../../../lib/routes';
import { ButtonComponent } from '../../ui/button.component';
import { PictureComponent } from '../../ui/picture.component';
import { PriceComponent } from '../../ui/price.component';
import { StoreConfigService } from '../../services/store-config.service';

@Component({
  selector: 'app-wishlist-row',
  standalone: true,
  imports: [ButtonComponent, PictureComponent, PriceComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="row"
      [attr.data-testid]="'wishlist-row-' + item().productId"
      data-testid-shared="wishlist-row"
    >
      <a class="image" [routerLink]="productHref()" tabindex="-1" aria-hidden="true">
        <app-picture
          [src]="imageSrc() ?? ''"
          alt=""
          aspectRatio="1 / 1"
          [width]="96"
          [height]="96"
        />
      </a>

      <div class="meta">
        <h3 class="name">
          <a class="name-link" [routerLink]="productHref()">{{ productNameText() }}</a>
        </h3>
        @if (priceAmount() !== null) {
          <app-price
            class="price"
            [amount]="priceAmount()!"
            [currency]="currencyCode()"
            taxMention="excluded"
          />
        }
        <p
          class="availability"
          [attr.data-state]="stockState()"
          data-testid="wishlist-row-availability"
        >
          @switch (stockState()) {
            @case ('in') {
              {{ strings().product.stock.inStock }}
            }
            @case ('low') {
              {{ strings().product.stock.lowStock }}
            }
            @case ('out') {
              {{ strings().product.stock.outOfStock }}
            }
          }
        </p>
        @if (isOutOfStock()) {
          <p class="oos" data-testid="wishlist-row-oos">
            {{ strings().account.wishlist.row.outOfStock }}
          </p>
        }
      </div>

      <div class="actions">
        <app-button
          variant="primary"
          size="sm"
          [disabled]="!canAddToCart() || addingToCart() || removing()"
          [loading]="addingToCart()"
          [attr.data-testid]="'wishlist-row-add-' + item().productId"
          (clicked)="addToCart.emit(item())"
        >
          {{
            addingToCart()
              ? strings().account.wishlist.row.addingLabel
              : strings().account.wishlist.row.addToCartCta
          }}
        </app-button>
        <app-button
          variant="tertiary"
          size="sm"
          [disabled]="removing() || addingToCart()"
          [loading]="removing()"
          [attr.data-testid]="'wishlist-row-remove-' + item().productId"
          (clicked)="remove.emit(item())"
        >
          {{
            removing()
              ? strings().account.wishlist.row.removingLabel
              : strings().account.wishlist.row.removeCta
          }}
        </app-button>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .row {
        display: grid;
        grid-template-columns: 96px 1fr auto;
        gap: 1rem;
        padding-block: 0.875rem;
        padding-inline: 0;
        border-block-end: 1px solid var(--brand-border);
        align-items: center;
      }
      @media (max-width: 640px) {
        .row {
          grid-template-columns: 72px 1fr;
        }
        .actions {
          grid-column: 1 / -1;
        }
      }
      .image {
        display: block;
        inline-size: 96px;
        block-size: 96px;
        background-color: var(--brand-bg);
      }
      .image:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .meta {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .name {
        margin: 0;
        font-family: var(--brand-font-display); /* agent_docs/storefront/brand-tokens.md subtitle */
        font-size: var(--brand-text-product);
        font-weight: 500;
        color: var(--brand-text);
      }
      .name-link {
        color: inherit;
        text-decoration: none;
      }
      .name-link:hover {
        color: var(--brand-primary);
      }
      .name-link:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .price {
        font-weight: 600;
      }
      .oos {
        margin: 0;
        color: var(--brand-error);
        font-size: var(--brand-text-micro);
      }
      /* Same tokens as the product page's stock pill, so a row and the page
         it links to cannot read as different states. */
      .availability {
        margin: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
      }
      .availability[data-state='in'] {
        color: var(--brand-success-text);
      }
      .availability[data-state='low'] {
        color: var(--brand-warning-text);
      }
      .availability[data-state='out'] {
        color: var(--brand-error);
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: stretch;
      }
    `,
  ],
})
export class WishlistRowComponent {
  readonly item = input.required<WishlistItem>();
  readonly addingToCart = input<boolean>(false);
  readonly removing = input<boolean>(false);

  @Output() readonly addToCart = new EventEmitter<WishlistItem>();
  @Output() readonly remove = new EventEmitter<WishlistItem>();

  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;

  protected readonly productHref = computed(() =>
    APP_ROUTES.product(this.locale.locale(), this.item().product.slug),
  );

  protected readonly productNameText = computed(() => {
    const name = this.item().product.name;
    if (typeof name === 'string') return name;
    return pickTranslation(name, this.locale.locale()) ?? '';
  });

  protected readonly imageSrc = computed(() => {
    const asset = this.item().product.primaryAsset;
    return asset?.url ?? null;
  });

  protected readonly priceAmount = computed(() => {
    const min = this.item().product.minPrice;
    if (min === undefined || min === null) return null;
    return Number(min);
  });

  private readonly storeConfig = inject(StoreConfigService);

  protected readonly currencyCode = computed(
    () => this.item().product.currency ?? this.storeConfig.currencyCode(),
  );

  /**
   * The three-state grade the API sends, mapped to the same short state token
   * the product page's stock pill uses so the two surfaces read alike.
   *
   * This used to be derived from `product.variants[]`, which the wishlist wire
   * has never carried, so the out-of-stock badge could not render for any row
   * on any store while Add-to-cart stayed enabled on sold-out products.
   */
  protected readonly stockState = computed<'in' | 'low' | 'out'>(() => {
    switch (this.item().availability) {
      case 'OUT_OF_STOCK':
        return 'out';
      case 'LOW_STOCK':
        return 'low';
      default:
        return 'in';
    }
  });

  protected readonly isOutOfStock = computed(() => this.stockState() === 'out');

  /**
   * Add-to-cart posts `variantId`. Null means the product has no active
   * variant, so the click could only fail; the button is disabled instead.
   */
  protected readonly canAddToCart = computed(() => !this.isOutOfStock() && !!this.item().variantId);
}
