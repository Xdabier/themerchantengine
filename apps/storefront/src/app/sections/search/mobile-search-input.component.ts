import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Input,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal,
  type AfterViewInit,
  type OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

import { LocaleService } from '../../locale.service';
import { APP_ROUTES } from '../../../lib/routes';
import { SearchService } from '@storefront-services';
import type { SuggestItem } from '@storefront-types';

import { SearchIconComponent } from '../../layout/icons/search-icon.component';
import { SuggestDropdownComponent, type SuggestSelectPayload } from './suggest-dropdown.component';

const SUGGEST_DEBOUNCE_MS = 200;
const SUGGEST_MIN_LENGTH = 2;

/**
 * Mobile-only inline search input rendered on the search page below the
 * page header. Visible only at `max-width: 767px` so it never collides
 * with the desktop header search-shell.
 *
 * Mirrors the header search behaviour: debounced suggest, keyboard nav,
 * outside-click dismissal, abort on stale responses. Shares
 * `SuggestDropdownComponent` for the listbox surface so AT and pointer
 * users get parity across surfaces.
 *
 * Pre-fills from the page's `?q=` value via the `initialQuery` input;
 * autofocuses on first paint when the query is empty so users landing on
 * `/search` from the bottom-nav shortcut can start typing immediately.
 */
@Component({
  selector: 'app-mobile-search-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchIconComponent, SuggestDropdownComponent],
  template: `
    <div class="shell" data-testid="mobile-search-shell">
      <form class="search" role="search" (submit)="onSubmit($event)">
        <label class="sr-only" [attr.for]="inputId">{{ strings().header.searchPlaceholder }}</label>
        <input
          #input
          [id]="inputId"
          type="search"
          name="q"
          autocomplete="off"
          role="combobox"
          [attr.aria-expanded]="isSuggestOpen()"
          [attr.aria-controls]="listboxId"
          aria-autocomplete="list"
          [attr.aria-activedescendant]="activeDescendantId()"
          [placeholder]="strings().header.searchPlaceholder"
          [value]="query()"
          (input)="onQueryInput($event)"
          (focus)="onInputFocus()"
          (keydown)="onInputKeydown($event)"
          data-testid="mobile-search-input"
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
          [listboxId]="listboxId"
          (select)="onSuggestSelect($event)"
          (activate)="activeIndex.set($event)"
        />
      }
      <span class="sr-only" aria-live="polite" data-testid="mobile-search-sr-status">{{
        suggestStatusAnnouncement()
      }}</span>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .shell {
        position: relative;
      }
      .search {
        display: flex;
        align-items: stretch;
        gap: 0;
        background-color: var(--brand-surface);
        /* The wrapper draws the boundary the inner input does not, so it is
           the control's edge for agent_docs/storefront/brand-tokens.md and WCAG 1.4.11. */
        border: 1px solid var(--brand-border-interactive);
        border-radius: var(--brand-radius-md);
        overflow: hidden;
      }
      .search input {
        flex: 1;
        min-block-size: 44px;
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

      @media (min-width: 768px) {
        :host {
          display: none;
        }
      }
    `,
  ],
})
export class MobileSearchInputComponent implements OnInit, AfterViewInit {
  private readonly localeService = inject(LocaleService);
  private readonly router = inject(Router);
  private readonly searchService = inject(SearchService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  /** Pre-fill from the page's `?q=` query parameter. */
  @Input() initialQuery: string | null = null;

  protected readonly inputId = 'mobile-search-input';
  protected readonly listboxId = 'mobile-search-listbox';

  protected readonly query = signal('');
  protected readonly suggestions = signal<SuggestItem[]>([]);
  protected readonly activeIndex = signal<number>(-1);
  protected readonly isSuggestOpen = signal<boolean>(false);
  protected readonly isSuggestLoading = signal<boolean>(false);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;

  @ViewChild('input', { static: true })
  protected readonly inputRef?: ElementRef<HTMLInputElement>;

  protected readonly suggestStatusAnnouncement = computed(() => {
    if (!this.isSuggestOpen()) return '';
    if (this.isSuggestLoading()) return this.strings().search.loading;
    const items = this.suggestions();
    if (items.length === 0) return this.strings().search.noSuggestions;
    return this.strings().search.resultsCount.replace('{count}', String(items.length));
  });

  protected readonly activeDescendantId = computed(() => {
    const idx = this.activeIndex();
    if (!this.isSuggestOpen() || idx < 0) return null;
    return `${this.listboxId}-option-${idx}`;
  });

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private inflightAbort: AbortController | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
      this.inflightAbort?.abort();
    });
  }

  ngOnInit(): void {
    if (this.initialQuery) {
      this.query.set(this.initialQuery);
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.query()) {
      // Autofocus on first paint when no query is pre-filled — landing on
      // /search from the bottom-nav shortcut should let users type
      // immediately.
      this.inputRef?.nativeElement.focus();
    }
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

  protected onSubmit(evt: Event): void {
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
      // eslint-disable-next-line no-console
      console.warn('[mobile-search] suggest failed', err);
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
    this.closeSuggest();
    const trimmed = this.query().trim();
    void this.router.navigate([APP_ROUTES.search(this.locale())], {
      queryParams: trimmed ? { q: trimmed } : {},
    });
  }

  private closeSuggest(): void {
    this.isSuggestOpen.set(false);
    this.activeIndex.set(-1);
    // Cancel any pending debounce + abort the inflight suggest call so a
    // late-arriving response cannot re-open the dropdown after the user
    // has dismissed it (Tab / Esc / outside-click).
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.inflightAbort?.abort();
    this.inflightAbort = null;
    this.isSuggestLoading.set(false);
  }
}
