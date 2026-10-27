import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  HostListener,
  ViewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { LocaleService } from '../locale.service';
import { APP_ROUTES } from '../../lib/routes';
import { CartService, SearchService } from '@storefront-services';
import {
  pickTranslation,
  type Category,
  type ResolvedString,
  type SuggestItem,
} from '@storefront-types';

import { CategoryNavService } from '../services/category-nav.service';
import { DrawerComponent } from '../ui/drawer.component';

import { CartIconComponent } from './icons/cart-icon.component';
import { MenuIconComponent } from './icons/menu-icon.component';
import { LanguageSwitcherComponent } from './language-switcher.component';
import { SearchIconComponent } from './icons/search-icon.component';
import {
  SuggestDropdownComponent,
  type SuggestSelectPayload,
} from '../sections/search/suggest-dropdown.component';
import { AccountMenuComponent } from '../sections/auth/account-menu.component';
import { DEFAULT_LOGO } from '../../lib/no-image';
import { StoreConfigService } from '../services/store-config.service';

const SUGGEST_DEBOUNCE_MS = 200;
const SUGGEST_MIN_LENGTH = 2;

/**
 * Top-level categories the desktop row shows before it would start wrapping
 * into the header. Everything past the cap stays one click away behind
 * "All products", and the drawer lists the whole tree.
 */
const DESKTOP_NAV_LIMIT = 8;

/** One category as the chrome renders it, with its children for the drawer. */
interface NavEntry {
  id: string;
  slug: string;
  label: string;
  href: string;
  children: Array<{ id: string; slug: string; label: string; href: string }>;
}

/**
 * Storefront top navigation. Wraps the bilingual brand lockup, a search
 * combobox with debounced suggest dropdown, the language toggle, and
 * the account + cart icons.
 *
 * The suggest dropdown debounces 200 ms before calling
 * `searchService.suggest({ q })`. Each new keystroke aborts the inflight
 * call via `AbortController` so a slower-arriving older response cannot
 * overwrite a fresher one. Keyboard nav (ArrowDown / ArrowUp / Enter /
 * Esc) and outside-click dismissal live on the host — the dropdown
 * itself only paints.
 *
 * The combobox a11y semantics live on this `<input>` per WAI-ARIA 1.2
 * §3.4: `role="combobox"`, `aria-expanded`, `aria-controls`,
 * `aria-autocomplete="list"`, `aria-activedescendant`. The dropdown
 * carries `role="listbox"`.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DrawerComponent,
    MenuIconComponent,
    RouterLink,
    AccountMenuComponent,
    CartIconComponent,
    LanguageSwitcherComponent,
    SearchIconComponent,
    SuggestDropdownComponent,
  ],
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-surface);
        border-block-end: 1px solid var(--brand-border-strong);
        position: sticky;
        inset-block-start: 0;
        z-index: 10;
      }

      .bar {
        display: grid;
        /* minmax(0, 1fr) is critical — without 0 as the min track size,
           the 1fr column inherits min-content sizing (i.e. the search
           input's placeholder width) and pushes the bar beyond a 360 px
           viewport. The same pattern keeps the auto tracks honest. */
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.75rem;
        padding-inline: clamp(1rem, 4vw, 2rem);
        padding-block: 0.75rem;
        max-inline-size: 1400px;
        margin-inline: auto;
      }

      .lockup {
        display: inline-flex;
        align-items: center;
        min-block-size: 44px;
        padding-inline: 0.25rem;
      }

      .lockup img {
        block-size: 36px;
        inline-size: auto;
      }

      .search-shell {
        position: relative;
        min-inline-size: 0;
      }

      .search {
        display: flex;
        align-items: stretch;
        gap: 0;
        background-color: var(--brand-surface);
        /* The wrapper draws the boundary the inner input does not, so it is
           the control edge for agent_docs/storefront/brand-tokens.md and WCAG 1.4.11. */
        border: 1px solid var(--brand-border-interactive);
        border-radius: var(--brand-radius-md);
        overflow: hidden;
        min-inline-size: 0;
      }

      .search input {
        flex: 1;
        min-block-size: 44px;
        /* min-inline-size: 0 — without it the input inherits the default
           min-inline-size: auto for flex children, which equals content
           min (the placeholder text width) and prevents shrinking below
           ~200 px on narrow viewports. */
        min-inline-size: 0;
        padding-inline: 0.875rem;
        padding-block: 0.5rem;
        font: inherit;
        color: var(--brand-text);
        background-color: transparent;
        border: none;
      }

      .search input::placeholder {
        color: var(--brand-text-muted);
      }

      /* Suppress the UA outline on pointer focus, keep it on keyboard focus
         so the contrast-checked focus ring still shows for AT users. */
      .search input:focus:not(:focus-visible) {
        outline: none;
      }

      .search input:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }

      .search button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding-inline: 0.75rem;
        font: inherit;
        font-weight: 500;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
        border: none;
        cursor: pointer;
      }

      .search button:hover,
      .search button:focus-visible {
        background-color: var(--brand-primary-dark);
      }

      .search button:focus-visible {
        outline: 2px solid var(--brand-on-primary);
        outline-offset: 2px;
      }

      .actions {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
      }

      .icon-link {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding-block: 0.5rem;
        padding-inline: 0.5rem;
        color: var(--brand-text);
        text-decoration: none;
        border-radius: var(--brand-radius-md);
      }

      .icon-link:hover {
        background-color: var(--brand-surface-strong);
      }

      .icon-link:focus-visible {
        background-color: var(--brand-surface-strong);
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }

      .icon-label,
      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin-block: 0;
        margin-inline: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .badge {
        position: absolute;
        inset-inline-end: 4px;
        inset-block-start: 4px;
        min-inline-size: 18px;
        block-size: 18px;
        padding-inline: 4px;
        font-size: 11px;
        font-weight: 600;
        line-height: 18px;
        text-align: center;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary-dark);
        border-radius: var(--brand-radius-full);
      }

      /* Same 44px tap target and hover / focus treatment as the sibling
         actions, without the icon slot. */
      .menu-toggle {
        display: none;
        align-items: center;
        justify-content: center;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--brand-text);
        cursor: pointer;
        border-radius: var(--brand-radius-md);
      }
      .menu-toggle:hover {
        background-color: var(--brand-surface-strong);
      }
      .menu-toggle:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .category-nav {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.25rem;
        padding-block: 0.25rem;
        padding-inline: 1rem;
        border-block-start: 1px solid var(--brand-border);
      }
      .category-nav a {
        display: inline-flex;
        align-items: center;
        min-block-size: 44px;
        padding-inline: 0.625rem;
        font-size: var(--brand-text-secondary);
        color: var(--brand-text);
        text-decoration: none;
        border-radius: var(--brand-radius-md);
      }
      .category-nav a:hover {
        background-color: var(--brand-surface-strong);
      }
      .category-nav a:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .category-nav a[aria-current='page'] {
        color: var(--brand-primary);
        font-weight: 500;
      }
      .menu-heading {
        margin: 0 0 0.75rem;
        font-family: var(--brand-font-display);
        font-size: var(--brand-text-product);
        font-weight: 500;
        color: var(--brand-text);
      }
      .menu-list,
      .menu-sublist {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .menu-sublist {
        padding-inline-start: 1rem;
      }
      .menu-list a {
        display: flex;
        align-items: center;
        min-block-size: 44px;
        color: var(--brand-text);
        text-decoration: none;
      }
      .menu-sublist a {
        font-size: var(--brand-text-secondary);
        color: var(--brand-text-muted);
      }
      .menu-list a[aria-current='page'] {
        color: var(--brand-primary);
        font-weight: 500;
      }
      .nav-link {
        display: inline-flex;
        align-items: center;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding-inline: 0.75rem;
        padding-block: 0.5rem;
        font: inherit;
        font-weight: 500;
        color: var(--brand-text);
        text-decoration: none;
        border-radius: var(--brand-radius-md);
      }

      .nav-link:hover {
        background-color: var(--brand-surface-strong);
      }

      .nav-link:focus-visible {
        background-color: var(--brand-surface-strong);
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }

      @media (max-width: 767px) {
        .menu-toggle {
          display: inline-flex;
        }
        /* The drawer is the mobile browse entry; two category surfaces on one
           360 px viewport is one too many. */
        .category-nav {
          display: none;
        }

        /* B2 — clarifications §3.17. Hide the header search-shell on
           narrow viewports; the sticky bottom-nav search shortcut is the
           sole mobile entry. The grid collapses to two auto tracks
           (lockup + actions) so the header still fits at 360 px, or three
           once the menu toggle renders. */
        .bar {
          grid-template-columns: auto auto;
          justify-content: space-between;
        }

        .bar:has(.menu-toggle) {
          grid-template-columns: auto minmax(0, 1fr) auto;
        }

        /* The drawer's "All products" link is the shop entry once the toggle
           renders, which frees the room the lockup needs at 360 px. */
        .bar:has(.menu-toggle) .nav-link {
          display: none;
        }

        .search-shell {
          display: none;
        }

        /* The lockup absorbs any squeeze left in its 1fr track. */
        .lockup {
          min-inline-size: 0;
        }

        .lockup img {
          block-size: 32px;
          max-inline-size: 100%;
          object-fit: contain;
        }

        .icon-link[data-mobile-hide='true'] {
          display: none;
        }
      }
    `,
  ],
  template: `
    <header role="banner">
      <div class="bar">
        <!--
          Finding M3, mobile half. Below 768 px the header search is hidden
          (clarifications §3.17) and the bottom nav is home / search / cart /
          account, so without this a phone visitor has no browse entry at all.
        -->
        @if (navEntries().length > 0) {
          <button
            #menuToggle
            type="button"
            class="menu-toggle"
            [attr.aria-label]="menuOpen() ? strings().header.menuClose : strings().header.menuOpen"
            [attr.aria-expanded]="menuOpen()"
            data-testid="header-menu-toggle"
            (click)="toggleMenu()"
          >
            <app-menu-icon [size]="22" />
          </button>
        }

        <a class="lockup" [routerLink]="homeRoute()" [attr.aria-label]="strings().brand.name">
          <img
            [src]="lockupSrc()"
            [alt]="strings().header.brandLockupAlt"
            width="180"
            height="36"
            loading="eager"
            decoding="sync"
            fetchpriority="high"
          />
        </a>

        <div class="search-shell">
          <form class="search" role="search" (submit)="onSearchSubmit($event)">
            <label class="icon-label" [attr.for]="searchInputId">{{
              strings().header.searchPlaceholder
            }}</label>
            <input
              [id]="searchInputId"
              type="search"
              name="q"
              autocomplete="off"
              role="combobox"
              [attr.aria-expanded]="isSuggestOpen()"
              [attr.aria-controls]="suggestListboxId"
              aria-autocomplete="list"
              [attr.aria-activedescendant]="activeDescendantId()"
              [placeholder]="strings().header.searchPlaceholder"
              [value]="query()"
              (input)="onQueryInput($event)"
              (focus)="onInputFocus()"
              (keydown)="onInputKeydown($event)"
              data-testid="header-search-input"
            />
            <button type="submit" [attr.aria-label]="strings().header.searchSubmit">
              <app-search-icon [size]="20" />
            </button>
          </form>

          @if (isSuggestOpen()) {
            <app-suggest-dropdown
              [items]="suggestions()"
              [query]="query()"
              [activeIndex]="activeIndex()"
              [isLoading]="isSuggestLoading()"
              [listboxId]="suggestListboxId"
              (select)="onSuggestSelect($event)"
              (activate)="activeIndex.set($event)"
            />
          }

          <span class="sr-only" aria-live="polite" data-testid="suggest-sr-status">{{
            suggestStatusAnnouncement()
          }}</span>
        </div>

        <div class="actions">
          <a class="nav-link" [routerLink]="catalogRoute()" data-testid="header-catalog-link">
            {{ strings().nav.catalog }}
          </a>

          <app-language-switcher idPrefix="header" [compact]="true" />

          <app-account-menu data-testid="header-account" />

          <a
            class="icon-link"
            [routerLink]="cartRoute()"
            [attr.aria-label]="strings().header.cartLabel"
            data-testid="header-cart"
          >
            <app-cart-icon [size]="22" />
            <span class="icon-label">{{ strings().header.cartLabel }}</span>
            @if (itemCount() > 0) {
              <span class="badge" aria-hidden="true" data-testid="header-cart-badge">{{
                itemCount()
              }}</span>
            }
          </a>

          <!--
            Cart-count live region. Kept outside the cart <a> per axe best-practice
            so AT does not re-announce the entire link on every count change.
            aria-live="polite" announces only the resolved count label, not
            the link's accessible name. Visually hidden via .sr-only.
          -->
          @if (itemCount() > 0) {
            <span class="sr-only" aria-live="polite" data-testid="header-cart-sr-status">{{
              cartCountA11yLabel()
            }}</span>
          }
        </div>
      </div>

      <!--
        Finding M3, desktop half. Text links only: the children are one click
        away on the category page, so a mega-menu would add a hover surface the
        brand floor has no tokens for. Renders nothing at all when the tree is
        empty, rather than an empty bar.
      -->
      @if (navEntries().length > 0) {
        <nav
          class="category-nav"
          [attr.aria-label]="strings().nav.categoriesLabel"
          data-testid="header-category-nav"
        >
          <a
            [routerLink]="catalogRoute()"
            [attr.aria-current]="isCatalogRoot() ? 'page' : null"
            data-testid="header-nav-all"
            >{{ strings().nav.allProducts }}</a
          >
          @for (entry of desktopEntries(); track entry.id) {
            <a
              [routerLink]="entry.href"
              [attr.aria-current]="entry.slug === activeCategorySlug() ? 'page' : null"
              >{{ entry.label }}</a
            >
          }
        </nav>
      }

      <app-drawer
        [open]="menuOpen()"
        side="start"
        labelledBy="header-menu-heading"
        (closed)="closeMenu()"
      >
        <div class="menu-panel" data-testid="header-menu-drawer">
          <h2 id="header-menu-heading" class="menu-heading">
            {{ strings().nav.categoriesLabel }}
          </h2>
          <ul role="list" class="menu-list">
            <li>
              <a
                [routerLink]="catalogRoute()"
                [attr.aria-current]="isCatalogRoot() ? 'page' : null"
                data-testid="header-menu-all"
                (click)="closeMenu()"
                >{{ strings().nav.allProducts }}</a
              >
            </li>
            @for (entry of navEntries(); track entry.id) {
              <li>
                <a
                  [routerLink]="entry.href"
                  [attr.aria-current]="entry.slug === activeCategorySlug() ? 'page' : null"
                  (click)="closeMenu()"
                  >{{ entry.label }}</a
                >
                @if (entry.children.length > 0) {
                  <ul role="list" class="menu-sublist">
                    @for (child of entry.children; track child.id) {
                      <li>
                        <a
                          [routerLink]="child.href"
                          [attr.aria-current]="child.slug === activeCategorySlug() ? 'page' : null"
                          (click)="closeMenu()"
                          >{{ child.label }}</a
                        >
                      </li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        </div>
      </app-drawer>
    </header>
  `,
})
export class HeaderComponent {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly router = inject(Router);
  private readonly cart = inject(CartService);
  private readonly searchService = inject(SearchService);
  private readonly categoryNav = inject(CategoryNavService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly query = signal('');
  protected readonly suggestions = signal<SuggestItem[]>([]);
  protected readonly activeIndex = signal<number>(-1);
  protected readonly isSuggestOpen = signal<boolean>(false);
  protected readonly isSuggestLoading = signal<boolean>(false);

  // Deterministic ids — Header is a singleton inside LayoutShell, so the
  // SSR-rendered ids match the hydrated client ids and Angular's hydration
  // diff stays clean.
  protected readonly menuOpen = signal(false);
  @ViewChild('menuToggle') private menuToggle?: ElementRef<HTMLButtonElement>;

  protected readonly searchInputId = 'header-search';
  protected readonly suggestListboxId = 'header-search-listbox';

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;
  protected readonly itemCount = this.cart.itemCount;

  protected readonly homeRoute = computed(() => APP_ROUTES.home(this.locale()));
  protected readonly cartRoute = computed(() => APP_ROUTES.cart(this.locale()));
  protected readonly catalogRoute = computed(() => APP_ROUTES.catalog(this.locale()));
  // One mark for every locale: the config carries a single logo, so there is
  // no per-locale artwork to choose between. The header grounds on the page,
  // so it takes the normal mark and the footer takes the reversed one.
  protected readonly lockupSrc = computed(() => this.storeConfig.logoUrl() ?? DEFAULT_LOGO);
  /**
   * The visible tree, resolved into this locale's labels. Reads the shared
   * store so the catalog chip strip and this row cost one request between
   * them, not two.
   */
  protected readonly navEntries = computed<NavEntry[]>(() => {
    const locale = this.locale();
    const toHref = (slug: string) => APP_ROUTES.catalog(locale, slug);
    const label = (cat: Category) => pickTranslation(cat.name as ResolvedString, locale);
    return this.categoryNav.topLevel().map((cat) => ({
      id: cat.id,
      slug: cat.slug,
      label: label(cat),
      href: toHref(cat.slug),
      children: (((cat as { children?: Category[] }).children ?? []) as Category[]).map(
        (child) => ({
          id: child.id,
          slug: child.slug,
          label: label(child),
          href: toHref(child.slug),
        }),
      ),
    }));
  });

  protected readonly desktopEntries = computed(() => this.navEntries().slice(0, DESKTOP_NAV_LIMIT));

  /**
   * Derived from the URL the language switch already reads, so the active
   * state costs no second router subscription.
   */
  private readonly catalogPath = computed(() => {
    const url = this.localeService.currentUrl().split('?')[0].split('#')[0];
    const prefix = APP_ROUTES.catalog(this.locale());
    if (url !== prefix && !url.startsWith(`${prefix}/`)) return null;
    return url.slice(prefix.length).replace(/^\/+|\/+$/g, '');
  });

  protected readonly isCatalogRoot = computed(() => this.catalogPath() === '');

  protected readonly activeCategorySlug = computed(() => {
    const rest = this.catalogPath();
    // `/catalog/product/<slug>` is a product, not a category, so nothing in
    // the row is current there.
    if (!rest || rest.includes('/')) return null;
    return rest;
  });

  protected readonly cartCountA11yLabel = computed(() =>
    this.strings().header.cartItemCountLabel.replace('{count}', String(this.itemCount())),
  );

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    // The drawer traps focus while open, so it has to hand it back rather than
    // dropping a keyboard visitor at the top of the document.
    afterNextRender(() => this.menuToggle?.nativeElement.focus(), { injector: this.injector });
  }

  protected readonly suggestStatusAnnouncement = computed(() => {
    if (!this.isSuggestOpen()) return '';
    if (this.isSuggestLoading()) return this.strings().search.loading;
    const items = this.suggestions();
    if (items.length === 0) return this.strings().search.noSuggestions;
    // Suggestion-count announcement for keyboard users (e.g.
    // "5 suggestions available"). Re-uses the bilingual `resultsCount`
    // template so the AR cadence stays grammatical.
    return this.strings().search.resultsCount.replace('{count}', String(items.length));
  });

  protected readonly activeDescendantId = computed(() => {
    const idx = this.activeIndex();
    if (!this.isSuggestOpen() || idx < 0) return null;
    return `${this.suggestListboxId}-option-${idx}`;
  });

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private inflightAbort: AbortController | null = null;

  constructor() {
    // Browser-only inside the service, so this is a no-op during SSR and the
    // nav row simply arrives with hydration (K5).
    void this.categoryNav.load();

    // A route change is the one thing that must close the drawer: the links
    // inside it navigate, and a panel left open over the destination would
    // trap focus on a page the visitor already left.
    effect(() => {
      this.localeService.currentUrl();
      // Untracked on purpose: reading `menuOpen` as a dependency would make
      // opening the drawer re-run this effect and close it again immediately.
      untracked(() => {
        if (this.menuOpen()) this.closeMenu();
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
      this.inflightAbort?.abort();
    });
  }

  protected onQueryInput(evt: Event): void {
    const value = (evt.target as HTMLInputElement).value;
    this.query.set(value);
    this.scheduleSuggest(value);
  }

  protected onInputFocus(): void {
    if (this.suggestions().length > 0 || this.isSuggestLoading()) {
      this.isSuggestOpen.set(true);
    }
  }

  protected onInputKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Escape') {
      if (this.isSuggestOpen()) {
        evt.preventDefault();
        this.closeSuggest();
      }
      return;
    }
    if (evt.key === 'Tab') {
      this.closeSuggest();
      return;
    }
    if (!this.isSuggestOpen() && (evt.key === 'ArrowDown' || evt.key === 'ArrowUp')) {
      if (this.suggestions().length > 0) this.isSuggestOpen.set(true);
    }
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      this.moveActive(1);
      return;
    }
    if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      this.moveActive(-1);
      return;
    }
    if (evt.key === 'Enter') {
      const idx = this.activeIndex();
      if (this.isSuggestOpen() && idx >= 0) {
        evt.preventDefault();
        this.commitActive(idx);
      }
    }
  }

  protected onSearchSubmit(evt: Event): void {
    evt.preventDefault();
    this.closeSuggest();
    const trimmed = this.query().trim();
    void this.router.navigate([APP_ROUTES.search(this.locale())], {
      queryParams: trimmed ? { q: trimmed } : {},
    });
  }

  protected onSuggestSelect(payload: SuggestSelectPayload): void {
    if (payload.kind === 'view-all') {
      this.navigateToResults();
      return;
    }
    this.navigateToItem(payload.item);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(evt: MouseEvent): void {
    const target = evt.target as Node | null;
    if (!target) return;
    const root = this.host.nativeElement;
    if (!root.contains(target)) {
      this.closeSuggest();
    }
  }

  private scheduleSuggest(rawQuery: string): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    const trimmed = rawQuery.trim();
    if (trimmed.length < SUGGEST_MIN_LENGTH) {
      this.suggestions.set([]);
      this.activeIndex.set(-1);
      this.isSuggestLoading.set(false);
      this.isSuggestOpen.set(false);
      this.inflightAbort?.abort();
      this.inflightAbort = null;
      return;
    }
    this.isSuggestOpen.set(true);
    this.isSuggestLoading.set(true);
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      void this.runSuggest(trimmed);
    }, SUGGEST_DEBOUNCE_MS);
  }

  private async runSuggest(q: string): Promise<void> {
    this.inflightAbort?.abort();
    const controller = new AbortController();
    this.inflightAbort = controller;
    try {
      const items = await this.searchService.suggest({ q });
      if (controller.signal.aborted) return;
      this.suggestions.set(items);
      // Nothing is active until the shopper arrows onto it. Auto-highlighting
      // the first item made Enter follow a suggestion instead of searching what
      // was typed (finding C8); WAI-ARIA calls that automatic selection and it
      // is opt-in.
      this.activeIndex.set(-1);
      this.isSuggestLoading.set(false);
      this.isSuggestOpen.set(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      this.suggestions.set([]);
      this.activeIndex.set(-1);
      this.isSuggestLoading.set(false);
      // Network failure on a suggest call should not blow up the input.
      // Surface to the dev console only.
      // eslint-disable-next-line no-console
      console.warn('[header] suggest failed', err);
    } finally {
      if (this.inflightAbort === controller) this.inflightAbort = null;
    }
  }

  private moveActive(delta: 1 | -1): void {
    const items = this.suggestions();
    if (items.length === 0) return;
    const total = items.length + (this.query().trim().length > 0 ? 1 : 0);
    const current = this.activeIndex();
    const next = current === -1 && delta === 1 ? 0 : (current + delta + total) % total;
    this.activeIndex.set(next);
  }

  private commitActive(index: number): void {
    const items = this.suggestions();
    if (index >= items.length) {
      this.navigateToResults();
      return;
    }
    const item = items[index];
    if (!item) return;
    this.navigateToItem(item);
  }

  private navigateToItem(item: SuggestItem): void {
    this.closeSuggest();
    if (item.slug) {
      // Backend `SearchService.suggest` returns a `type` discriminator —
      // category-typed suggestions route to the catalog list, product-typed
      // (and unknown legacy payloads with a slug) route to product detail.
      const path =
        item.type === 'category'
          ? APP_ROUTES.catalog(this.locale(), item.slug)
          : APP_ROUTES.product(this.locale(), item.slug);
      void this.router.navigate([path]);
      return;
    }
    this.query.set(item.label);
    void this.router.navigate([APP_ROUTES.search(this.locale())], {
      queryParams: { q: item.label },
    });
  }

  private navigateToResults(): void {
    const trimmed = this.query().trim();
    this.closeSuggest();
    void this.router.navigate([APP_ROUTES.search(this.locale())], {
      queryParams: trimmed ? { q: trimmed } : {},
    });
  }

  private closeSuggest(): void {
    this.isSuggestOpen.set(false);
    this.activeIndex.set(-1);
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.inflightAbort?.abort();
    this.inflightAbort = null;
    this.isSuggestLoading.set(false);
  }
}
