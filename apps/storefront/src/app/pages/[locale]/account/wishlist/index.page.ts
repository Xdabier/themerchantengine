import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { CartService, WishlistService } from '@storefront-services';
import {
  StorefrontError,
  StorefrontUnauthorizedError,
  type PaginationMeta,
  type WishlistItem,
} from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { WishlistStateService } from '../../../../services/wishlist-state.service';
import { APP_ROUTES } from '../../../../../lib/routes';
import { WishlistRowComponent } from '../../../../sections/account/wishlist-row.component';
import { SpinnerComponent } from '../../../../ui/spinner.component';
import { ensureAuthedForAccount } from '../_account-auth-guard';
import { AccountNavComponent } from '../../../../sections/account/account-nav.component';
import { pageTitle } from '../../../../../lib/seo';

type PageState = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 12;

@Component({
  selector: 'app-account-wishlist-page',
  standalone: true,
  imports: [AccountNavComponent, RouterLink, SpinnerComponent, WishlistRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="account-wishlist-page">
      <app-account-nav />
      <header class="header">
        <h1 class="title">{{ strings().account.wishlist.heading }}</h1>
      </header>

      @if (mutationMessage()) {
        <p
          class="status-message"
          role="status"
          aria-live="polite"
          data-testid="account-wishlist-status"
        >
          {{ mutationMessage() }}
        </p>
      }
      @if (mutationError()) {
        <p class="error" role="alert" data-testid="account-wishlist-mutation-error">
          {{ mutationError() }}
        </p>
      }

      @switch (state()) {
        @case ('loading') {
          <div
            class="loading"
            role="status"
            aria-live="polite"
            data-testid="account-wishlist-loading"
          >
            <app-spinner size="md" />
            <span>{{ strings().account.shared.loading }}</span>
          </div>
        }
        @case ('error') {
          <p class="error" role="alert" data-testid="account-wishlist-error">
            {{ strings().account.shared.loadError }}
          </p>
        }
        @case ('ready') {
          @if (items().length === 0) {
            <div class="empty" data-testid="account-wishlist-empty">
              <h2 class="empty-title">{{ strings().account.wishlist.empty.title }}</h2>
              <p class="empty-body">{{ strings().account.wishlist.empty.body }}</p>
              <a
                class="empty-cta"
                [routerLink]="catalogHref()"
                data-testid="account-wishlist-empty-cta"
              >
                {{ strings().account.wishlist.empty.cta }}
              </a>
            </div>
          } @else {
            <ul class="rows" data-testid="account-wishlist-list">
              @for (it of items(); track it.productId) {
                <li class="row-item">
                  <app-wishlist-row
                    [item]="it"
                    [removing]="busyId() === it.productId && busyAction() === 'remove'"
                    [addingToCart]="busyId() === it.productId && busyAction() === 'add'"
                    (remove)="onRemove($event)"
                    (addToCart)="onAddToCart($event)"
                  />
                </li>
              }
            </ul>

            @if (totalPages() > 1) {
              <nav
                class="pagination"
                [attr.aria-label]="strings().account.wishlist.pagination.navLabel"
                data-testid="account-wishlist-pagination"
              >
                <button
                  type="button"
                  class="page-btn"
                  [disabled]="page() <= 1"
                  data-testid="account-wishlist-prev"
                  (click)="onPageChange(page() - 1)"
                >
                  {{ strings().account.wishlist.pagination.previous }}
                </button>
                <span role="status" aria-live="polite">{{ pageLabel() }}</span>
                <button
                  type="button"
                  class="page-btn"
                  [disabled]="page() >= totalPages()"
                  data-testid="account-wishlist-next"
                  (click)="onPageChange(page() + 1)"
                >
                  {{ strings().account.wishlist.pagination.next }}
                </button>
              </nav>
            }
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding-block: 1.5rem;
        padding-inline: 1rem;
        max-inline-size: 1280px;
        margin-inline: auto;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
      }
      .status-message {
        margin: 0;
        padding-block: 0.5rem;
        padding-inline: 0.75rem;
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-sm);
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .pagination {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-block-start: 1rem;
      }
      .page-btn {
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        padding-block: 0.5rem;
        padding-inline: 1rem;
        font: inherit;
        cursor: pointer;
        border-radius: var(--brand-radius-sm);
        min-block-size: 44px;
      }
      .page-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .page-btn:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .empty {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: start;
        padding-block: 2rem;
      }
      .empty-title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .empty-body {
        margin: 0;
        color: var(--brand-text-muted);
      }
      .empty-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 44px;
        padding-block: 0.625rem;
        padding-inline: 1.25rem;
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        font-weight: 600;
      }
      .empty-cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .loading {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
        color: var(--brand-text-muted);
        padding-block: 1rem;
      }
      .error {
        margin: 0;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-error);
        border-inline-start: 3px solid var(--brand-error);
        border-radius: var(--brand-radius-sm);
      }
    `,
  ],
})
export class AccountWishlistPageComponent implements OnInit {
  private readonly locale = inject(LocaleService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly wishlist = inject(WishlistService);
  private readonly wishlistState = inject(WishlistStateService);
  private readonly cartSvc = inject(CartService);

  protected readonly strings = this.locale.strings;
  protected readonly state = signal<PageState>('idle');
  protected readonly items = signal<WishlistItem[]>([]);
  protected readonly metaData = signal<PaginationMeta | null>(null);
  protected readonly page = signal<number>(1);
  protected readonly busyId = signal<string | null>(null);
  protected readonly busyAction = signal<'add' | 'remove' | null>(null);
  protected readonly mutationMessage = signal<string | null>(null);
  protected readonly mutationError = signal<string | null>(null);

  protected readonly totalPages = computed(() => {
    const m = this.metaData();
    if (!m || m.pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(m.total / m.pageSize));
  });

  protected readonly pageLabel = computed(() =>
    this.strings()
      .account.wishlist.pagination.currentPage.replace('{page}', String(this.page()))
      .replace('{total}', String(this.totalPages())),
  );

  protected readonly catalogHref = computed(() => APP_ROUTES.catalog(this.locale.locale()));

  ngOnInit(): void {
    this.title.setTitle(
      pageTitle(this.strings().account.meta.wishlistTitle, this.strings().brand.name),
    );
    this.meta.updateTag({ name: 'robots', content: 'noindex,nofollow' });

    if (!isPlatformBrowser(this.platformId)) return;
    void this.init();
  }

  /**
   * Browser-side entry. The state flips to `'loading'` BEFORE the guard is
   * awaited so the page never sits in the unrendered `'idle'` branch while
   * the session boot settles (finding N4).
   */
  private async init(): Promise<void> {
    this.state.set('loading');
    if (
      !(await ensureAuthedForAccount(
        { authState: this.authState, locale: this.locale, router: this.router },
        APP_ROUTES.account.wishlist(this.locale.locale()),
      ))
    ) {
      return;
    }
    const pageRaw = this.route.snapshot.queryParamMap.get('page');
    const pageNum = pageRaw ? Number(pageRaw) : 1;
    this.page.set(Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1);
    void this.load();
  }

  protected onPageChange(next: number): void {
    if (next < 1 || next > this.totalPages()) return;
    this.page.set(next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: next },
      queryParamsHandling: 'merge',
    });
    void this.load();
  }

  private async load(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await this.wishlist.list({ page: this.page(), pageSize: PAGE_SIZE });
      this.items.set(result.data);
      this.metaData.set(result.meta);
      this.state.set('ready');
    } catch (cause) {
      if (cause instanceof StorefrontUnauthorizedError) {
        this.authState.clearSession();
        void ensureAuthedForAccount(
          { authState: this.authState, locale: this.locale, router: this.router },
          APP_ROUTES.account.wishlist(this.locale.locale()),
        );
        return;
      }
      if (cause instanceof StorefrontError) {
        this.state.set('error');
        return;
      }
      this.state.set('error');
    }
  }

  protected async onRemove(item: WishlistItem): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(item.productId);
    this.busyAction.set('remove');
    this.mutationError.set(null);
    try {
      // Through the store, not the API service: every heart elsewhere on the
      // session has to stop showing this product as wishlisted too.
      await this.wishlistState.remove(item.productId);
      await this.load();
      this.mutationMessage.set(this.strings().account.wishlist.removed);
    } catch (err: unknown) {
      this.mutationError.set(this.removeErrorMessageFor(err));
    } finally {
      this.busyId.set(null);
      this.busyAction.set(null);
    }
  }

  /**
   * Dispatch a wishlist-remove failure to localized copy. The backend emits
   * `WISHLIST_PRODUCT_NOT_FOUND` (B2 row #22) for orphaned product ids;
   * unknown codes fall back to the generic remove-error copy. Both branches
   * resolve to the same string today; the dispatch is structurally
   * code-aware so the contract is honored.
   */
  private removeErrorMessageFor(err: unknown): string {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'WISHLIST_PRODUCT_NOT_FOUND') return this.strings().account.wishlist.removeError;
    return this.strings().account.wishlist.removeError;
  }

  protected async onAddToCart(item: WishlistItem): Promise<void> {
    if (this.busyId()) return;
    // The row's own variantId, emitted by the API. The old code read
    // `product.variants[0]`, and the wishlist wire has never carried a
    // variants list, so this handler could only ever fail. The row disables
    // the button when there is nothing to buy, so this guard is a backstop.
    const variantId = item.variantId;
    if (!variantId) {
      this.mutationError.set(this.strings().account.wishlist.addToCartError);
      return;
    }
    this.busyId.set(item.productId);
    this.busyAction.set('add');
    this.mutationError.set(null);
    try {
      await this.cartSvc.addItem({ variantId, quantity: 1 });
      this.mutationMessage.set(this.strings().account.wishlist.addedToCart);
    } catch {
      this.mutationError.set(this.strings().account.wishlist.addToCartError);
    } finally {
      this.busyId.set(null);
      this.busyAction.set(null);
    }
  }
}

export default AccountWishlistPageComponent;
