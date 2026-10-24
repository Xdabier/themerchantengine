import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { StorefrontUnauthorizedError } from '@storefront-types';

import { HeartIconComponent } from '../../layout/icons/heart-icon.component';
import { LocaleService } from '../../locale.service';
import { WishlistStateService } from '../../services/wishlist-state.service';
import { ToastService } from '../../ui/toast.component';

type Variant = 'inline' | 'overlay';

/**
 * Copy override for the four `product.wishlist.*` strings.
 *
 * The wishlist is already the interest signal the back-in-stock fan-out reads
 * (`back-in-stock.listener.ts`, operator decision O6), so an out-of-stock buy
 * box needs this control saying "Notify me when it is back" rather than a
 * second control built beside it. Only the words differ; the mutation, the
 * store and the error handling are the same.
 */
export interface WishlistToggleLabels {
  add: string;
  remove: string;
  added: string;
  removed: string;
}

/**
 * Inline / overlay wishlist toggle. Mounted by `ProductCardComponent` at the
 * catalog grid (overlay variant) and by `ProductSummaryComponent` on the
 * product detail page (inline variant).
 *
 * `pressed` is a view over `WishlistStateService`, never local state. The
 * component used to boot its own `signal(false)` with nothing anywhere
 * fetching membership, so a wishlisted product rendered an empty heart after
 * every reload and the next click silently re-added it (finding W1). Reading
 * the shared store also keeps the card heart, the buy-box heart and the
 * wishlist page in agreement after any one of them mutates.
 *
 * Mutations funnel through the store, which applies them optimistically and
 * rolls back on failure. On rejection the localized error goes to a toast AND
 * to the aria-live span here: writing it only to the `.sr-only` span was
 * finding W6, where a sighted visitor watched the heart fill, unfill, and got
 * no explanation at all.
 *
 * A 401 is left to the global handler in `app.config.ts`, which clears the
 * session and navigates to login threading `?from=`. This component adds the
 * missing reason as a toast and never navigates itself: a second redirect
 * would race the global one and lose the `?from=`.
 */
@Component({
  selector: 'wishlist-toggle',
  standalone: true,
  imports: [HeartIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="toggle"
      [class.is-overlay]="variant() === 'overlay'"
      [class.is-inline]="variant() === 'inline'"
      [attr.aria-pressed]="pressed()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-busy]="busy() ? 'true' : null"
      [disabled]="busy()"
      (click)="toggle()"
    >
      <app-heart-icon [size]="iconSize()" [filled]="pressed()" />
      @if (variant() === 'inline') {
        <span class="label" data-testid="wishlist-toggle-label">{{ ariaLabel() }}</span>
      }
      <span class="sr-only" aria-live="polite" data-testid="wishlist-toggle-status">
        {{ statusMessage() }}
      </span>
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        min-block-size: 44px;
        min-inline-size: 44px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--brand-text);
        cursor: pointer;
      }
      /* In the buy box the control sits beside a full-width primary button, so
         it has to read as the secondary action rather than as decoration.
         Logical properties throughout; the overlay variant is untouched. */
      .toggle.is-inline {
        /* Same height as the primary add-to-cart button, so the pair reads as
           one row of actions rather than a button with an ornament beside it. */
        min-block-size: 52px;
        block-size: 100%;
        padding-inline: 1rem;
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        background-color: var(--brand-surface);
        font-family: inherit;
        font-size: var(--brand-text-body);
        font-weight: 500;
      }
      .toggle.is-inline:hover:not([disabled]) {
        border-color: var(--brand-primary);
        color: var(--brand-primary);
      }
      .label {
        white-space: nowrap;
      }
      .toggle.is-overlay {
        position: absolute;
        inset-block-start: 0.5rem;
        inset-inline-end: 0.5rem;
        background-color: var(--brand-overlay-bg);
        border-radius: var(--brand-radius-full);
        box-shadow: var(--brand-shadow-xs);
      }
      .toggle:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
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
      .toggle[aria-pressed='true'] {
        color: var(--brand-primary);
      }
      .toggle[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class WishlistToggleComponent {
  private readonly localeService = inject(LocaleService);
  private readonly wishlistState = inject(WishlistStateService);
  private readonly toasts = inject(ToastService);

  readonly productId = input.required<string>();
  readonly variant = input<Variant>('inline');
  readonly iconSize = input<number>(20);
  /** Absent means the plain wishlist copy, so the card overlay and the
   * in-stock buy box are untouched. */
  readonly labels = input<WishlistToggleLabels | null>(null);

  private readonly copy = computed<WishlistToggleLabels>(() => {
    const override = this.labels();
    if (override) return override;
    const w = this.strings().product.wishlist;
    return { add: w.add, remove: w.remove, added: w.added, removed: w.removed };
  });

  protected readonly pressed = computed(() => this.wishlistState.isWishlisted(this.productId()));
  protected readonly busy = signal(false);
  protected readonly statusMessage = signal('');

  protected readonly strings = this.localeService.strings;
  protected readonly ariaLabel = computed(() =>
    this.pressed() ? this.copy().remove : this.copy().add,
  );

  async toggle(): Promise<void> {
    if (this.busy()) return;
    const next = !this.pressed();
    this.busy.set(true);
    this.statusMessage.set('');
    try {
      if (next) {
        await this.wishlistState.add(this.productId());
        this.statusMessage.set(this.copy().added);
      } else {
        await this.wishlistState.remove(this.productId());
        this.statusMessage.set(this.copy().removed);
      }
    } catch (err: unknown) {
      // The store already rolled the optimistic change back, so `pressed`
      // reverts on its own; only the announcement is left to make.
      const message = this.messageFor(err);
      this.statusMessage.set(message);
      if (err instanceof StorefrontUnauthorizedError) {
        // Root-scoped, so it survives the global handler's navigation to login
        // and tells the visitor why they landed there.
        this.toasts.warning(message);
      } else {
        this.toasts.error(message);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Dispatch a wishlist mutation failure to localized copy. An anonymous click
   * gets the sign-in prompt; the backend's `WISHLIST_PRODUCT_NOT_FOUND` and
   * every unknown code fall back to the generic wishlist-error copy. The
   * not-found case maps to the same string today; the dispatch is
   * structurally code-aware so the contract is honored.
   */
  private messageFor(err: unknown): string {
    if (err instanceof StorefrontUnauthorizedError) {
      return this.strings().product.wishlist.signInToSave;
    }
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'WISHLIST_PRODUCT_NOT_FOUND') return this.strings().product.wishlist.error;
    return this.strings().product.wishlist.error;
  }
}
