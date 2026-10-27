import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { StorefrontLinkStore } from '../../core/stores/storefront-link.store';

/**
 * Link from a product in the admin to the page a customer sees.
 *
 * Renders nothing at all when the public config is unhydrated or failed. A
 * plausible-looking origin is worse than no link: the two clients are co-hosted,
 * so a guess can open the wrong shop.
 *
 * A non-ACTIVE product deliberately renders INERT TEXT rather than a disabled
 * anchor. `getProductBySlug` filters on ACTIVE, so a draft's public URL 404s,
 * and `aria-disabled` on an anchor that still has an `href` remains
 * keyboard-activatable: it would be a dead link that axe cannot detect. The
 * absence of an anchor is the thing worth asserting.
 */
@Component({
  selector: 'app-storefront-link',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url(); as href) {
      @if (isLive()) {
        <a
          [href]="href"
          target="_blank"
          rel="noopener noreferrer"
          [attr.aria-label]="accessibleName()"
          class="inline-flex items-center min-h-[44px] text-xs tabular text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="product-storefront-link"
        >
          View on storefront
          <span aria-hidden="true" class="ms-1">↗</span>
        </a>
      } @else {
        <span
          class="inline-flex flex-col text-xs tabular text-ink-muted"
          data-testid="product-storefront-link-inactive"
        >
          <span>Not live — this product is {{ status() }}.</span>
          <span class="font-mono">{{ href }}</span>
        </span>
      }
    }
  `,
})
export class StorefrontLinkComponent {
  private readonly store = inject(StorefrontLinkStore);

  readonly slug = input<string | null>(null);
  readonly status = input<string | null>(null);
  readonly productName = input<string | null>(null);

  protected readonly url = computed(() => this.store.productUrl(this.slug()));
  protected readonly isLive = computed(() => this.status() === 'ACTIVE');

  /**
   * Names the product AND says a new tab opens: the visible text does neither,
   * and a context change with no warning is the a11y failure here.
   */
  protected readonly accessibleName = computed(() => {
    const name = this.productName();
    return name
      ? `View ${name} on the storefront (opens in a new tab)`
      : 'View on the storefront (opens in a new tab)';
  });
}
