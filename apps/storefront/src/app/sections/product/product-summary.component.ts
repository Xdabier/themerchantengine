import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { RouterLink } from '@angular/router';

import { looksLikeRichTextHtml } from '../../../lib/rich-text';
import { APP_ROUTES } from '../../../lib/routes';
import { LocaleService } from '../../locale.service';
import { PriceComponent } from '../../ui/price.component';
import {
  AVAILABILITY_STATE,
  type AvailabilityState,
  type ProductAvailability,
} from '../../ui/product-card.component';
import { RatingComponent } from '../../ui/rating.component';
import { StepperComponent } from '../../ui/stepper.component';
import { WishlistToggleComponent, type WishlistToggleLabels } from './wishlist-toggle.component';

export type AddToCartState = 'idle' | 'submitting' | 'success' | 'error';

/**
 * What the buy box asks for. The quantity used to be hardcoded to 1 by the
 * page (finding P4), so the variant alone was enough; now the shopper picks it
 * and the request has to carry both.
 */
export interface AddToCartRequest {
  variant: ProductVariantOption;
  quantity: number;
}

export interface ProductVariantOption {
  id: string;
  label: string;
  price: number;
  compareAtPrice?: number | null;
  /**
   * The binary that drives the buy path: the add-to-cart disabled state, the
   * variant picker's disabled attribute, and the out-of-stock pill. Carried
   * alongside `availability` rather than derived from it, so the producer
   * states both instead of the template guessing one from the other.
   */
  inStock: boolean;
  /** The three-state signal agent_docs/storefront/brand-tokens.md keeps visible on the page. */
  availability: ProductAvailability;
  /** Product reference, rendered as an identifier per agent_docs/storefront/brand-tokens.md. */
  sku: string;
}

export interface ProductSummaryInput {
  /**
   * Product id — required so the inline wishlist-toggle can target the
   * product. Optional for back-compat with any caller that passes a
   * partial input; the toggle hides when absent.
   */
  productId?: string;
  title: string;
  /**
   * One-line pitch under the title. Sanitized on the same server path as the
   * description, so it may carry markup even though it is normally authored
   * plain, and it renders through the same dual mode.
   */
  shortDescription?: string;
  description?: string;
  brand?: string | null;
  variants: ProductVariantOption[];
  currency: string;
  ratingValue?: number;
  reviewCount?: number;
}

/**
 * Why the description is bound with [innerHTML] and hosted in a DIV.
 *
 * The admin authors it with TranslatableRichTextComponent, so the stored value
 * is HTML. This was interpolated, which escapes, so the customer read a literal
 * "<p>...</p>". Rendering through Angular's default [innerHTML] sanitiser
 * matches the precedent at pages/[locale]/about.page.ts, and plain-text legacy
 * content is unaffected because a text node is sanitiser-safe.
 *
 * The host is a DIV, not a P. The editor allowlist admits paragraphs, lists and
 * headings, none of which may legally sit inside a P: the parser would
 * auto-close it and re-parent the siblings, so the SSR bytes and the hydrated
 * DOM would disagree and Angular would report a hydration mismatch.
 *
 * No bypassSecurityTrustHtml. The value is already scrubbed twice on write, in
 * the admin editor and again in products.service.ts, and the runtime sanitiser
 * is the last gate worth keeping.
 *
 * Why there are two branches.
 *
 * The seeded catalogue predates the editor: those descriptions are plain text
 * whose paragraphs are \n breaks. HTML rendering collapses them into one dense
 * blob, so plain values render in a P with white-space: pre-wrap instead. The
 * FAQ answers on the same page have always done this. The branch is chosen by
 * looksLikeRichTextHtml, which tests the sanitizer allow-list rather than a
 * bare "<", so a specification reading "angle < 30 degres" stays plain.
 *
 * The explanation lives here rather than as a template comment on purpose:
 * Angular preserves HTML comments in the rendered output, so a comment this
 * long would ship to every visitor.
 */
@Component({
  selector: 'product-summary',
  standalone: true,
  imports: [RouterLink, StepperComponent, PriceComponent, RatingComponent, WishlistToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="summary" data-testid="product-summary">
      @if (input().brand) {
        <p class="brand">{{ input().brand }}</p>
      }
      <h1 class="title">{{ input().title }}</h1>

      @if (input().shortDescription) {
        @if (isRichShortDescription()) {
          <!-- innerhtml-approved: admin-authored rich text, sanitized on write by sanitizeRichTextHtml against a safe-tag allowlist (constitution 3.5); Angular sanitizes again on render. No bypassSecurityTrust* involved. -->
          <div
            class="short-description rich-text-content"
            data-testid="product-short-description"
            [innerHTML]="input().shortDescription"
          ></div>
        } @else {
          <p class="short-description" data-testid="product-short-description">
            {{ input().shortDescription }}
          </p>
        }
      }
      @if ((input().reviewCount ?? 0) > 0) {
        <app-rating [value]="input().ratingValue ?? 0" [count]="input().reviewCount ?? 0" />
      }
      @if (activeVariant().sku) {
        <p class="reference" data-testid="product-reference">
          <span class="reference-label">{{ strings().product.reference }}</span>
          <span class="reference-value" data-testid="product-reference-value">{{
            activeVariant().sku
          }}</span>
        </p>
      }
      <div class="price-row">
        <app-price
          [amount]="activeVariant().price"
          [compareAt]="activeVariant().compareAtPrice ?? null"
          [currency]="input().currency"
          taxMention="excluded"
        />
      </div>
      <p class="stock" [attr.data-state]="stockState()" data-testid="product-availability">
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
      <!-- Finding P3: the promise sat between the "Out of stock" line and the
           disabled button, promising a delivery date for something the page
           refused to sell. LOW_STOCK keeps it: it can still be bought. -->
      @if (stockState() !== 'out') {
        <p class="delivery">{{ strings().product.delivery.estimate }}</p>
      }

      @if (input().variants.length > 1) {
        <fieldset class="variants">
          <legend class="variants-legend">{{ strings().product.variant.label }}</legend>
          <ul role="list" class="variant-list">
            @for (v of input().variants; track v.id) {
              <li>
                <button
                  type="button"
                  class="variant"
                  [class.active]="v.id === selectedVariantId()"
                  [class.oos]="!v.inStock"
                  [disabled]="!v.inStock"
                  [attr.aria-pressed]="v.id === selectedVariantId()"
                  [attr.data-testid]="'variant-' + v.id"
                  (click)="selectVariant(v)"
                >
                  {{ v.label }}
                  @if (!v.inStock) {
                    <span class="oos-pill">{{ strings().product.variant.outOfStock }}</span>
                  }
                </button>
              </li>
            }
          </ul>
        </fieldset>
      }

      @if (activeVariant().inStock) {
        <app-stepper
          class="quantity"
          [value]="quantity()"
          [min]="1"
          [max]="MAX_QUANTITY"
          [disabled]="addState() === 'submitting'"
          [groupLabel]="strings().product.quantity.label"
          [incrementLabel]="strings().product.quantity.increase"
          [decrementLabel]="strings().product.quantity.decrease"
          (valueChange)="quantity.set($event)"
          data-testid="product-quantity"
        />
      }

      <div class="cta-row">
        <button
          type="button"
          class="add-to-cart"
          data-testid="product-add-to-cart"
          [disabled]="!activeVariant().inStock || addState() === 'submitting'"
          [attr.aria-busy]="addState() === 'submitting' ? 'true' : null"
          (click)="onAddToCart()"
        >
          <!--
            Finding P4: the label used to flip to "Added to cart", which reads
            as terminal, so a second click looked wrong even though it added
            another unit. The outcome is stated below the row instead; the
            button always says what it does.
          -->
          @if (addState() === 'submitting') {
            {{ strings().product.addingToCart }}
          } @else if (activeVariant().inStock) {
            {{ strings().product.addToCart }}
          } @else {
            {{ strings().product.outOfStock }}
          }
        </button>
        @if (input().productId) {
          <wishlist-toggle
            variant="inline"
            [productId]="input().productId!"
            [iconSize]="22"
            [labels]="notifyLabels()"
          />
        }
      </div>

      <!--
        Finding P3: an out-of-stock buy box offered nothing to do, although the
        engine already emails every wishlister of the product when stock crosses
        back above zero. Lifecycle consent is opt-in, so the hint names the
        switch to turn on rather than promising mail we may not be allowed to
        send.
      -->
      @if (notifyLabels()) {
        <p class="back-in-stock-hint" data-testid="product-back-in-stock-hint">
          {{ strings().product.backInStock.hint }}
          <a [routerLink]="preferencesRoute()" data-testid="product-preferences-link">{{
            strings().product.backInStock.preferencesLink
          }}</a>
        </p>
      }

      @if (addState() === 'error') {
        <p class="error" role="alert" data-testid="product-add-to-cart-error">
          {{ addErrorMessage() ?? strings().product.addToCartError }}
        </p>
      }

      @if (addState() === 'success') {
        <p class="add-status" role="status" data-testid="product-add-to-cart-status">
          {{ addedCountMessage() }}
          <a [routerLink]="cartRoute()" data-testid="product-view-cart">{{
            strings().product.viewCart
          }}</a>
        </p>
      }

      <span class="sr-only" aria-live="polite">{{ addStateAnnounce() }}</span>

      @if (input().description) {
        @if (isRichDescription()) {
          <!-- innerhtml-approved: admin-authored rich text, sanitized on write by sanitizeRichTextHtml against a safe-tag allowlist (constitution 3.5); Angular sanitizes again on render. No bypassSecurityTrust* involved. -->
          <div
            class="description rich-text-content"
            data-testid="product-description"
            [innerHTML]="input().description"
          ></div>
        } @else {
          <p class="description description-plain" data-testid="product-description">
            {{ plainDescription() }}
          </p>
        }
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .summary {
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
      }
      /* No uppercasing and no capital-tuned tracking: agent_docs/storefront/brand-tokens.md keeps a
         third-party manufacturer's name as the manufacturer writes it, and
         §8.2 forbids shouted capitals in UI copy. */
      .brand {
        margin: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text-muted);
      }
      .title {
        margin: 0;
        font-family: var(--brand-font-display);
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
        line-height: 1.2;
      }
      .reference {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.375rem;
        font-size: var(--brand-text-secondary);
        color: var(--brand-text-muted);
      }
      /* agent_docs/storefront/brand-tokens.md: the mono face is strictly for identifiers, so it sits
         on the reference value and never on the label beside it. */
      .reference-value {
        font-family: var(--brand-font-mono);
        font-weight: 500;
        color: var(--brand-text);
      }
      .price-row {
        margin-block-start: 0.25rem;
      }
      .quantity {
        align-self: flex-start;
      }
      .back-in-stock-hint {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        font-size: var(--brand-text-secondary);
        color: var(--brand-text-muted);
      }
      .back-in-stock-hint a {
        color: var(--brand-primary);
      }
      .add-status {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        font-size: var(--brand-text-secondary);
        color: var(--brand-success-text);
      }
      .add-status a {
        color: var(--brand-primary);
      }
      .stock {
        margin: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
      }
      .stock[data-state='in'] {
        color: var(--brand-success-text);
      }
      .stock[data-state='low'] {
        color: var(--brand-warning-text);
      }
      .stock[data-state='out'] {
        color: var(--brand-error);
      }
      .delivery {
        margin: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      .variants {
        border: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .variants-legend {
        padding: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text);
      }
      .variant-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .variant {
        font: inherit;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        min-block-size: 44px;
        min-inline-size: 44px;
        padding-block: 0.5rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border-strong);
        border-radius: var(--brand-radius-md);
        cursor: pointer;
      }
      .variant:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .variant.active {
        border-color: var(--brand-primary);
        background-color: var(--brand-surface-strong);
      }
      .variant.oos {
        color: var(--brand-text-muted);
        border-color: var(--brand-border);
      }
      .oos-pill {
        font-size: var(--brand-text-micro);
        background-color: var(--brand-surface-strong);
        padding-inline: 0.375rem;
        padding-block: 0.125rem;
        border-radius: var(--brand-radius-sm);
      }
      .cta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: stretch;
      }
      /* The wishlist control carries a visible label now, and the French one
         is long, so the pair wraps instead of crushing the primary action. */
      .cta-row wishlist-toggle {
        flex: 1 1 12rem;
      }
      .cta-row .add-to-cart {
        flex: 1;
      }
      .add-to-cart {
        font: inherit;
        font-weight: 600;
        min-block-size: 52px;
        padding-block: 0.875rem;
        padding-inline: 1.5rem;
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
        border: 1px solid var(--brand-primary);
        border-radius: var(--brand-radius-md);
        cursor: pointer;
      }
      .add-to-cart:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .add-to-cart:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .error {
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-error);
      }
      .short-description {
        margin: 0;
        font-size: var(--brand-text-body);
        line-height: 1.5;
        color: var(--brand-text-muted);
      }
      .description {
        margin: 0;
        font-size: var(--brand-text-body);
        line-height: 1.6;
        color: var(--brand-text);
      }
      /*
        Legacy plain text keeps its authored line breaks. Scoped to the plain
        branch: pre-wrap on an HTML description would turn the whitespace
        between its tags into visible gaps.
      */
      .description-plain {
        white-space: pre-wrap;
      }
      /*
        Typography for the injected children lives in the global stylesheet
        under .rich-text-content, shared with the category page. It cannot live
        here: injected children carry no _ngcontent attribute, so a scoped rule
        matches nothing, and the ::ng-deep escape hatch this used to rely on
        forced a second copy of the same rules on every other surface that
        renders authored HTML.
      */
      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class ProductSummaryComponent {
  readonly input = input.required<ProductSummaryInput>();
  readonly addState = input<AddToCartState>('idle');
  readonly addErrorMessage = input<string | null>(null);

  readonly variantSelected = output<ProductVariantOption>();
  readonly addToCart = output<AddToCartRequest>();

  protected readonly selectedVariantId = signal<string | null>(null);

  /**
   * The cart line's own cap, not a stock claim: the exact count is deliberately
   * off the public wire (`docs/storefront-api-reference.md`, brand floor §8.2),
   * so the server stays the authority and answers an over-ask with
   * CART_INSUFFICIENT_STOCK, which the page already renders.
   */
  protected readonly MAX_QUANTITY = 99;
  protected readonly quantity = signal(1);

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());

  protected readonly activeVariant = computed<ProductVariantOption>(() => {
    const list = this.input().variants;
    const id = this.selectedVariantId();
    return (
      list.find((v) => v.id === id) ??
      list[0] ?? {
        id: '',
        label: '',
        price: 0,
        inStock: false,
        availability: 'OUT_OF_STOCK',
        sku: '',
      }
    );
  });

  protected readonly stockState = computed<AvailabilityState>(
    () => AVAILABILITY_STATE[this.activeVariant().availability],
  );

  protected readonly cartRoute = computed(() => APP_ROUTES.cart(this.localeService.locale()));

  protected readonly preferencesRoute = computed(() =>
    APP_ROUTES.account.preferences(this.localeService.locale()),
  );

  /**
   * Null while the product can be bought, so the control keeps its plain
   * wishlist copy everywhere else on the site.
   */
  protected readonly notifyLabels = computed<WishlistToggleLabels | null>(() => {
    if (this.stockState() !== 'out') return null;
    const b = this.strings().product.backInStock;
    return { add: b.notify, remove: b.stop, added: b.added, removed: b.removed };
  });

  protected readonly addedCountMessage = computed(() =>
    this.strings().product.addedToCartWithCount.replace('{count}', String(this.lastAddedCount())),
  );

  /**
   * The count the confirmation names is the one that was sent, not whatever the
   * stepper reads now: the stepper stays usable while the message is up, so
   * reading it live would rewrite a statement about what already happened.
   */
  private readonly lastAddedCount = signal(1);

  protected readonly addStateAnnounce = computed(() => {
    const s = this.strings().product;
    switch (this.addState()) {
      case 'submitting':
        return s.addingToCart;
      case 'success':
        return this.addedCountMessage();
      case 'error':
        return s.addToCartError;
      default:
        return '';
    }
  });

  protected readonly isRichDescription = computed(() =>
    looksLikeRichTextHtml(this.input().description),
  );
  protected readonly plainDescription = computed(() => this.input().description ?? '');
  protected readonly isRichShortDescription = computed(() =>
    looksLikeRichTextHtml(this.input().shortDescription),
  );

  protected selectVariant(v: ProductVariantOption): void {
    if (!v.inStock) return;
    this.selectedVariantId.set(v.id);
    // A quantity chosen against one variant says nothing about another one's
    // stock, so it starts over rather than carrying across.
    this.quantity.set(1);
    this.variantSelected.emit(v);
  }

  protected onAddToCart(): void {
    const v = this.activeVariant();
    if (!v.inStock) return;
    const quantity = this.quantity();
    this.lastAddedCount.set(quantity);
    this.addToCart.emit({ variant: v, quantity });
  }
}
