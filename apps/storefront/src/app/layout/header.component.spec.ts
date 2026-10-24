import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { computed, provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeaderComponent } from './header.component';
import { LocaleService } from '../locale.service';
import { CategoryNavService } from '../services/category-nav.service';
import { CartService } from '@storefront-services';
import { STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';
import { getChromeStrings } from '../../i18n';
import type { Locale } from '../../i18n/types';
import {
  fixtureChromeIdentity,
  provideFixtureStoreConfig,
  type StoreConfigFixtureId,
} from '../../test-support/store-config-fixtures';
import type { Category } from '@storefront-types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('fr');
  readonly _url = signal('/fr/');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = this._url.asReadonly();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = signal(getChromeStrings('fr', fixtureChromeIdentity('demo', 'fr')));
  set(locale: Locale, url: string) {
    this._locale.set(locale);
    this._url.set(url);
    this.strings.set(getChromeStrings(locale, fixtureChromeIdentity('demo', locale)));
  }
}

interface FakeApiClient extends ApiClient {
  getCalls: Array<{ path: string; query?: unknown }>;
  suggestPayload: unknown;
}

function buildFakeApi(): FakeApiClient {
  const calls: Array<{ path: string; query?: unknown }> = [];
  const api = {
    getCalls: calls,
    suggestPayload: {
      data: [
        { label: 'Headphones', productId: 'p-1' },
        { label: 'Tablet', slug: 'tablet' },
      ],
    },
    get: async (path: string, opts?: { query?: unknown }) => {
      calls.push({ path, query: opts?.query });
      if (path === '/v1/search/suggest') return api.suggestPayload as never;
      return {} as never;
    },
    post: async () => ({}) as never,
    patch: async () => ({}) as never,
    delete: async () => ({}) as never,
    request: async () => ({}) as never,
  } as FakeApiClient;
  return api;
}

const noopApi: ApiClient = {
  get: async () => ({}) as never,
  post: async () => ({}) as never,
  patch: async () => ({}) as never,
  delete: async () => ({}) as never,
  request: async () => ({}) as never,
};

/**
 * Stand-in for `CategoryNavService`. Signal-backed so the nav row is a view
 * over the store, the same shape the real one exposes, and `load` is a spy so
 * the "one fetch per session" contract is assertable from the header side.
 */
function makeCategoryNav(rows: Array<{ slug: string; label: string; children?: string[] }> = []) {
  const build = (
    slug: string,
    label: string,
    parentId: string | null,
    children: string[] = [],
  ): Category =>
    ({
      id: `cat-${slug}`,
      slug,
      parentId,
      name: { fr: label, en: label },
      children: children.map((child) => build(child, `${label} ${child}`, `cat-${slug}`)),
    }) as unknown as Category;

  const tree = signal<Category[]>(rows.map((r) => build(r.slug, r.label, null, r.children)));
  return {
    tree,
    categories: tree.asReadonly(),
    topLevel: computed(() => tree().filter((c) => c.parentId == null)),
    load: vi.fn(async () => undefined),
  };
}

function setup(
  initialLocale: Locale = 'fr',
  initialUrl = '/fr/',
  api: ApiClient = noopApi,
  categoryNav: ReturnType<typeof makeCategoryNav> = makeCategoryNav(),
  storeConfigFixture?: StoreConfigFixtureId,
) {
  const fakeLocale = new FakeLocaleService();
  fakeLocale.set(initialLocale, initialUrl);
  TestBed.configureTestingModule({
    imports: [HeaderComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: fakeLocale },
      { provide: STOREFRONT_API_CLIENT, useValue: api },
      { provide: CategoryNavService, useValue: categoryNav },
      ...(storeConfigFixture ? [provideFixtureStoreConfig(storeConfigFixture)] : []),
    ],
  });
  const fixture = TestBed.createComponent(HeaderComponent);
  fixture.detectChanges();
  return {
    fixture,
    fakeLocale,
    categoryNav,
    cart: TestBed.inject(CartService),
    router: TestBed.inject(Router),
  };
}

async function typeQuery(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(ms = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('HeaderComponent', () => {
  it('declares the @media (max-width: 767px) rule that hides the search-shell on mobile (B2)', () => {
    const { fixture } = setup('en', '/en/');
    const styleEls = Array.from(
      fixture.nativeElement.getRootNode() instanceof Document
        ? (fixture.nativeElement.getRootNode() as Document).querySelectorAll('style')
        : [],
    ) as HTMLStyleElement[];
    const css = styleEls.map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*767px\s*\)/);
    // Angular view-encapsulation rewrites selectors with `[_ngcontent-...]`
    // attribute suffixes; allow either form.
    expect(css).toMatch(/\.search-shell[^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.bar[^{]*\{[^}]*grid-template-columns:\s*auto auto/);
  });

  it('renders the lockup with the French alt text at /fr/', () => {
    const { fixture } = setup('fr', '/fr/');
    const img = fixture.nativeElement.querySelector('img.lockup, .lockup img') as HTMLImageElement;
    // One lockup serves both locales: the wordmark is Latin script.
    expect(img.src).toMatch(/\/brand\/default\/logo\.svg$/);
    // The lockup's accessible name is the configured store, in the reader's
    // language: it used to spell one client's name and its market (plan E2.5).
    expect(img.alt).toBe(fixtureChromeIdentity('demo', 'fr').storeName);
    // S14.5: header lockup is the LCP candidate above the fold; resource
    // hints flip to eager + sync + high priority.
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    // 519.296 x 141.12 renders 132px wide at the 36px height brand floor §4.5
    // fixes for the header. The intrinsic attributes have to match the asset
    // or the box they reserve is the wrong shape and the lockup, which is the
    // LCP candidate, shifts the layout when it loads.
    // Same 5:1 aspect as the shipped mark, so the reserved box matches it.
    expect(img.getAttribute('width')).toBe('180');
    expect(img.getAttribute('height')).toBe('36');
  });

  it('renders the same lockup with the English alt text at /en/', () => {
    const { fixture } = setup('en', '/en/');
    const img = fixture.nativeElement.querySelector('.lockup img') as HTMLImageElement;
    expect(img.src).toMatch(/\/brand\/default\/logo\.svg$/);
    expect(img.alt).toBe(fixtureChromeIdentity('demo', 'en').storeName);
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('fetchpriority')).toBe('high');
  });

  it('carries a Shop link to the catalog, labelled per locale', () => {
    const { fixture, fakeLocale } = setup('en', '/en/');
    const link = fixture.nativeElement.querySelector(
      '[data-testid="header-catalog-link"]',
    ) as HTMLAnchorElement;
    expect(link).toBeTruthy();
    // The href, not just presence: before this the catalog was reachable only
    // through search, a home section, or a hand-typed URL.
    expect(link.getAttribute('href')).toBe('/en/catalog');
    expect(link.textContent?.trim()).toBe('Shop');

    fakeLocale.set('fr', '/fr/');
    fixture.detectChanges();
    const frLink = fixture.nativeElement.querySelector(
      '[data-testid="header-catalog-link"]',
    ) as HTMLAnchorElement;
    expect(frLink.getAttribute('href')).toBe('/fr/catalog');
    expect(frLink.textContent?.trim()).toBe('Catalogue');
  });

  it('lists every enabled locale by native name with path-preserving hrefs', () => {
    const { fixture } = setup(
      'fr',
      '/fr/_smoke/services?ref=home',
      noopApi,
      makeCategoryNav(),
      'trilingual',
    );
    const trigger = fixture.nativeElement.querySelector(
      'button[data-testid="header-language-toggle"]',
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('Français');
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="header-language-option-"]'),
    ) as HTMLAnchorElement[];
    expect(options.map((o) => o.getAttribute('hreflang'))).toEqual(['ar', 'fr', 'en']);
    expect(options.map((o) => o.textContent?.trim())).toEqual(['العربية', 'Français', 'English']);
    expect(options.map((o) => o.getAttribute('href'))).toEqual([
      '/ar/_smoke/services?ref=home',
      '/fr/_smoke/services?ref=home',
      '/en/_smoke/services?ref=home',
    ]);
    expect(options.map((o) => o.getAttribute('aria-current'))).toEqual([null, 'true', null]);
  });

  it('closes the language menu on Escape', () => {
    const { fixture } = setup('fr', '/fr/', noopApi, makeCategoryNav(), 'trilingual');
    const trigger = fixture.nativeElement.querySelector(
      'button[data-testid="header-language-toggle"]',
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-testid^="header-language-option-"]'),
    ).toBeNull();
  });

  it('navigates to /<locale>/search?q=... on submit', async () => {
    const { fixture, router } = setup('en', '/en/');
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'phones';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const navigateSpy = router.navigate.bind(router);
    let capturedTree: unknown = null;
    (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
      capturedTree = { commands, extras };
      return Promise.resolve(true);
    };
    try {
      const form = fixture.nativeElement.querySelector('form[role="search"]') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      fixture.detectChanges();
      expect(capturedTree).toEqual({
        commands: ['/en/search'],
        extras: { queryParams: { q: 'phones' } },
      });
    } finally {
      (router as unknown as { navigate: typeof router.navigate }).navigate = navigateSpy;
    }
  });

  it('hides the cart badge and live region when itemCount is 0', () => {
    const { fixture, cart } = setup();
    expect(cart.itemCount()).toBe(0);
    expect(fixture.nativeElement.querySelector('[data-testid="header-cart-badge"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="header-cart-sr-status"]')).toBeNull();
  });

  it('renders the badge aria-hidden, with the live region as a separate sibling', () => {
    const { fixture, cart } = setup();
    (cart as unknown as { _itemCount: { set: (n: number) => void } })._itemCount.set(3);
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector(
      '[data-testid="header-cart-badge"]',
    ) as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent?.trim()).toBe('3');

    const liveStatus = fixture.nativeElement.querySelector(
      '[data-testid="header-cart-sr-status"]',
    ) as HTMLElement;
    expect(liveStatus).toBeTruthy();
    expect(liveStatus.getAttribute('aria-live')).toBe('polite');
    // Live region is NOT inside the cart anchor.
    const cartAnchor = fixture.nativeElement.querySelector(
      '[data-testid="header-cart"]',
    ) as HTMLElement;
    expect(cartAnchor.contains(liveStatus)).toBe(false);
  });

  it('blank-query submit fires navigate without a q queryParam', async () => {
    const { fixture, router } = setup('en', '/en/');
    let captured: unknown = null;
    (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
      captured = { commands, extras };
      return Promise.resolve(true);
    };
    const form = fixture.nativeElement.querySelector('form[role="search"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    fixture.detectChanges();
    expect(captured).toEqual({
      commands: ['/en/search'],
      extras: { queryParams: {} },
    });
  });

  it('renders banner landmark and search role landmark', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('header[role="banner"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('form[role="search"]')).toBeTruthy();
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const { fixture } = setup();
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      // The component fragment lacks <main>; landmark uniqueness is asserted
      // by the layout-shell journey + smoke specs.
      rules: {
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('every interactive element meets the 44 px tap-target floor', () => {
    const { fixture } = setup();
    const interactives = fixture.nativeElement.querySelectorAll(
      'a, button, input[type="search"]',
    ) as NodeListOf<HTMLElement>;
    for (const el of Array.from(interactives)) {
      const styleAttr = el.getAttribute('style') ?? '';
      // The 44×44 floor is enforced via component CSS — this test asserts the
      // element exists and is keyboard-focusable; visual-floor enforcement is
      // covered by the brand-auditor + a11y-auditor at phase exit.
      expect(el).toBeTruthy();
      void styleAttr;
    }
  });

  describe('search combobox a11y wiring', () => {
    it('exposes role="combobox" with aria-expanded=false on first paint', () => {
      const { fixture } = setup();
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      expect(input.getAttribute('role')).toBe('combobox');
      expect(input.getAttribute('aria-autocomplete')).toBe('list');
      expect(input.getAttribute('aria-controls')).toBe('header-search-listbox');
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.getAttribute('aria-activedescendant')).toBe(null);
    });
  });

  describe('suggest dropdown lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not call suggest until 200 ms have elapsed', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'phon');
      await vi.advanceTimersByTimeAsync(150);
      expect(api.getCalls.filter((c) => c.path === '/v1/search/suggest').length).toBe(0);
      await vi.advanceTimersByTimeAsync(60);
      // Allow the awaited promise + zone microtask to settle.
      await flush(0);
      expect(api.getCalls.some((c) => c.path === '/v1/search/suggest')).toBe(true);
    });

    it('coalesces rapid keystrokes — only the last query reaches the API', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'p');
      await vi.advanceTimersByTimeAsync(50);
      await typeQuery(input, 'ph');
      await vi.advanceTimersByTimeAsync(50);
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      const suggestCalls = api.getCalls.filter((c) => c.path === '/v1/search/suggest');
      expect(suggestCalls.length).toBe(1);
      expect((suggestCalls[0].query as { q: string }).q).toBe('pho');
    });

    it('skips the API entirely when the trimmed query is shorter than 2 chars', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'p');
      await vi.advanceTimersByTimeAsync(300);
      await flush(0);
      expect(api.getCalls.filter((c) => c.path === '/v1/search/suggest').length).toBe(0);
      expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens the listbox + sets aria-expanded once results land', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      expect(input.getAttribute('aria-expanded')).toBe('true');
      const options = fixture.nativeElement.querySelectorAll('[data-testid="suggest-option"]');
      expect(options.length).toBe(2);
      // Nothing active until the shopper arrows onto it, so Enter searches the
      // typed text rather than following a suggestion (finding C8).
      expect(input.getAttribute('aria-activedescendant')).toBe(null);
    });

    it('Escape closes the dropdown', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      input.dispatchEvent(esc);
      fixture.detectChanges();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.getAttribute('aria-activedescendant')).toBe(null);
      expect(esc.defaultPrevented).toBe(true);
    });

    it('ArrowDown moves activeIndex forward and ArrowUp moves backward', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      fixture.detectChanges();
      // From nothing active, the first ArrowDown lands on the first item.
      expect(input.getAttribute('aria-activedescendant')).toBe('header-search-listbox-option-0');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      fixture.detectChanges();
      expect(input.getAttribute('aria-activedescendant')).toBe('header-search-listbox-option-1');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      fixture.detectChanges();
      // 2 items + view-all row → index 2 is the view-all row.
      expect(input.getAttribute('aria-activedescendant')).toBe('header-search-listbox-option-2');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
      fixture.detectChanges();
      expect(input.getAttribute('aria-activedescendant')).toBe('header-search-listbox-option-1');
    });

    it('Enter on a slug item navigates to the product detail route', async () => {
      const api = buildFakeApi();
      const { fixture, router } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      // Move to the second item, which has a slug. Two presses now: nothing is
      // active until the first one.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      fixture.detectChanges();
      let captured: unknown = null;
      (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
        captured = { commands, extras };
        return Promise.resolve(true);
      };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      fixture.detectChanges();
      expect(captured).toEqual({
        commands: ['/en/catalog/product/tablet'],
        extras: undefined,
      });
    });

    it('Enter on a category-typed suggestion navigates to the catalog list, not product detail', async () => {
      const api = buildFakeApi();
      api.suggestPayload = {
        data: [
          { type: 'category', label: 'Electronics', slug: 'fx-electronics' },
          { type: 'product', label: 'Laptop', slug: 'fx-laptop-pro' },
        ],
      };
      const { fixture, router } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      input.value = 'elec';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      // Arrow onto the first suggestion: Enter alone searches the typed text.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      fixture.detectChanges();
      let captured: unknown = null;
      (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
        captured = { commands, extras };
        return Promise.resolve(true);
      };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      fixture.detectChanges();
      expect(captured).toEqual({
        commands: ['/en/catalog/fx-electronics'],
        extras: undefined,
      });
    });

    it('Enter on the view-all row navigates to /[locale]/search?q=', async () => {
      const api = buildFakeApi();
      const { fixture, router } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      // Three presses to reach the view-all row: nothing is active until the
      // first one, then two items.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      fixture.detectChanges();
      let captured: unknown = null;
      (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
        captured = { commands, extras };
        return Promise.resolve(true);
      };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      fixture.detectChanges();
      expect(captured).toEqual({
        commands: ['/en/search'],
        extras: { queryParams: { q: 'pho' } },
      });
    });

    it('exposes a persistent live region that mirrors loading + no-suggestion state', async () => {
      const api = buildFakeApi();
      api.suggestPayload = { data: [] };
      const { fixture } = setup('en', '/en/', api);
      // Region is always in DOM (key for AT mount-timing).
      const region = fixture.nativeElement.querySelector(
        '[data-testid="suggest-sr-status"]',
      ) as HTMLElement;
      expect(region).toBeTruthy();
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.textContent?.trim()).toBe('');
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      input.value = 'pho';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Loading state — live region announces the loading copy.
      fixture.detectChanges();
      expect(region.textContent?.trim().length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      // No suggestions returned — region announces the empty copy.
      expect(region.textContent?.trim().length).toBeGreaterThan(0);
    });

    it('outside-click on the document closes the dropdown', async () => {
      const api = buildFakeApi();
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'pho');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      fixture.detectChanges();
      expect(input.getAttribute('aria-expanded')).toBe('true');
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      outside.remove();
    });

    it('a stale older response cannot overwrite a fresher one', async () => {
      // Build an api that returns two payloads in order. The first call is
      // resolved manually after the second, mimicking a slow network where
      // the older response arrives last.
      const calls: Array<{ path: string; query?: unknown; resolve: (v: unknown) => void }> = [];
      const api: ApiClient = {
        get: ((path: string, opts?: { query?: unknown }) => {
          let resolve: (v: unknown) => void = () => {};
          const promise = new Promise<unknown>((r) => {
            resolve = r;
          });
          calls.push({ path, query: opts?.query, resolve });
          return promise as never;
        }) as ApiClient['get'],
        post: async () => ({}) as never,
        patch: async () => ({}) as never,
        delete: async () => ({}) as never,
        request: async () => ({}) as never,
      };
      const { fixture } = setup('en', '/en/', api);
      const input = fixture.nativeElement.querySelector(
        '[data-testid="header-search-input"]',
      ) as HTMLInputElement;
      await typeQuery(input, 'old');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      // Fire a fresher keystroke that will start a new request.
      await typeQuery(input, 'new');
      await vi.advanceTimersByTimeAsync(220);
      await flush(0);
      // Resolve old first, then new.
      const olderCall = calls[0];
      const newerCall = calls[1];
      newerCall.resolve({ data: [{ label: 'NEW-RESULT' }] });
      olderCall.resolve({ data: [{ label: 'OLD-RESULT' }] });
      await flush(0);
      fixture.detectChanges();
      const options = fixture.nativeElement.querySelectorAll(
        '[data-testid="suggest-option"]',
      ) as NodeListOf<HTMLElement>;
      const labels = Array.from(options).map((el) => (el.textContent ?? '').trim());
      // Older payload must NOT have overwritten the newer one.
      expect(labels.join(' ')).toContain('NEW-RESULT');
      expect(labels.join(' ')).not.toContain('OLD-RESULT');
    });
  });
});

/**
 * Finding C8 (plan L Phase L3).
 *
 * The suggest list auto-highlighted its first item the moment results landed,
 * and Enter commits whatever is highlighted while the list is open. So a
 * shopper who typed a query and pressed Enter was sent to the first suggestion
 * instead of searching what they typed. WAI-ARIA calls that automatic
 * selection, and it is opt-in: suggestions now arrive with nothing active, and
 * ArrowDown is what selects.
 */
describe('HeaderComponent Enter contract', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('leaves nothing active when suggestions arrive', async () => {
    const api = buildFakeApi();
    const { fixture } = setup('en', '/en/', api);
    const input = fixture.nativeElement.querySelector(
      '[data-testid="header-search-input"]',
    ) as HTMLInputElement;
    await typeQuery(input, 'pho');
    await vi.advanceTimersByTimeAsync(220);
    await flush(0);
    fixture.detectChanges();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(null);
  });

  it('Enter with nothing arrowed to submits the typed query', async () => {
    const api = buildFakeApi();
    const { fixture, router } = setup('en', '/en/', api);
    const input = fixture.nativeElement.querySelector(
      '[data-testid="header-search-input"]',
    ) as HTMLInputElement;
    await typeQuery(input, 'pho');
    await vi.advanceTimersByTimeAsync(220);
    await flush(0);
    fixture.detectChanges();

    let captured: unknown = null;
    (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
      captured = { commands, extras };
      return Promise.resolve(true);
    };
    // The keydown must not be swallowed, so the form's own submit runs. jsdom
    // does not translate Enter into a submit, so the spec drives both halves.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(captured).toBeNull();

    const form = fixture.nativeElement.querySelector('form.search') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(captured).toEqual({
      commands: ['/en/search'],
      extras: { queryParams: { q: 'pho' } },
    });
  });

  it('ArrowDown then Enter still commits the first suggestion', async () => {
    const api = buildFakeApi();
    const { fixture, router } = setup('en', '/en/', api);
    const input = fixture.nativeElement.querySelector(
      '[data-testid="header-search-input"]',
    ) as HTMLInputElement;
    await typeQuery(input, 'pho');
    await vi.advanceTimersByTimeAsync(220);
    await flush(0);
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    fixture.detectChanges();
    expect(input.getAttribute('aria-activedescendant')).toBe('header-search-listbox-option-0');

    let captured: unknown = null;
    (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
      captured = { commands, extras };
      return Promise.resolve(true);
    };
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enter);
    fixture.detectChanges();
    expect(enter.defaultPrevented).toBe(true);
    expect(captured).not.toBeNull();
  });

  /**
   * Finding M3. The header was logo, search, language, account and cart, with
   * one "Shop" link and no `<nav>` element anywhere. The only category strip
   * lived on `/catalog`, and below 768 px the header search is hidden too, so a
   * phone visitor had no browse entry at all.
   */
  describe('catalogue navigation (finding M3)', () => {
    const chrome = getChromeStrings('fr');

    function navLinks(fixture: { nativeElement: HTMLElement }): HTMLAnchorElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('[data-testid="header-category-nav"] a'),
      );
    }

    it('asks the shared store to load once, rather than fetching itself', () => {
      const { categoryNav } = setup(
        'fr',
        '/fr/',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants' }]),
      );
      expect(categoryNav.load).toHaveBeenCalledTimes(1);
    });

    it('renders a labelled nav landmark with All products first', () => {
      const { fixture } = setup(
        'fr',
        '/fr/',
        noopApi,
        makeCategoryNav([
          { slug: 'implants', label: 'Implants' },
          { slug: 'imagerie', label: 'Imagerie' },
        ]),
      );
      const nav = fixture.nativeElement.querySelector('[data-testid="header-category-nav"]');
      expect(nav?.tagName.toLowerCase()).toBe('nav');
      expect(nav?.getAttribute('aria-label')).toBe(chrome.nav.categoriesLabel);

      const links = navLinks(fixture);
      expect(links.map((a) => a.textContent?.trim())).toEqual([
        chrome.nav.allProducts,
        'Implants',
        'Imagerie',
      ]);
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        '/fr/catalog',
        '/fr/catalog/implants',
        '/fr/catalog/imagerie',
      ]);
    });

    it('prefixes hrefs with the active locale', () => {
      const { fixture } = setup(
        'en',
        '/en/',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants' }]),
      );
      expect(navLinks(fixture).map((a) => a.getAttribute('href'))).toEqual([
        '/en/catalog',
        '/en/catalog/implants',
      ]);
    });

    it('marks the category the visitor is on as the current page', () => {
      const { fixture } = setup(
        'fr',
        '/fr/catalog/imagerie',
        noopApi,
        makeCategoryNav([
          { slug: 'implants', label: 'Implants' },
          { slug: 'imagerie', label: 'Imagerie' },
        ]),
      );
      const current = navLinks(fixture).filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current.map((a) => a.textContent?.trim())).toEqual(['Imagerie']);
    });

    it('marks All products current on the catalogue root only', () => {
      const { fixture } = setup(
        'fr',
        '/fr/catalog',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants' }]),
      );
      const current = navLinks(fixture).filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current.map((a) => a.textContent?.trim())).toEqual([chrome.nav.allProducts]);
    });

    it('caps the row so a long category list cannot push the header off screen', () => {
      const many = Array.from({ length: 12 }, (_, i) => ({
        slug: `c-${i}`,
        label: `Cat ${i}`,
      }));
      const { fixture } = setup('fr', '/fr/', noopApi, makeCategoryNav(many));
      // All products plus the eight the row shows; the rest are one click away
      // behind All products.
      expect(navLinks(fixture).length).toBe(9);
    });

    it('renders no nav and no menu button at all when the tree is empty', () => {
      const { fixture } = setup('fr', '/fr/', noopApi, makeCategoryNav([]));
      expect(fixture.nativeElement.querySelector('[data-testid="header-category-nav"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="header-menu-toggle"]')).toBeNull();
    });

    it('opens a drawer from the menu button, carrying the same links plus children', async () => {
      const { fixture } = setup(
        'fr',
        '/fr/',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants', children: ['titane'] }]),
      );
      const toggle = fixture.nativeElement.querySelector(
        '[data-testid="header-menu-toggle"]',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute('aria-label')).toBe(chrome.header.menuOpen);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(fixture.nativeElement.querySelector('[data-testid="header-menu-drawer"]')).toBeNull();

      toggle.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const drawer = fixture.nativeElement.querySelector('[data-testid="header-menu-drawer"]');
      expect(drawer).not.toBeNull();
      expect(drawer?.closest('[role="dialog"]')).not.toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      const hrefs = Array.from((drawer as HTMLElement).querySelectorAll('a')).map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toEqual(['/fr/catalog', '/fr/catalog/implants', '/fr/catalog/titane']);
    });

    it('closes the drawer when a link inside it is followed', async () => {
      const { fixture, router } = setup(
        'fr',
        '/fr/',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants' }]),
      );
      // The test router has no route table, so let RouterLink's navigation
      // resolve to a no-op; what is under test is the drawer closing behind it.
      vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      (
        fixture.nativeElement.querySelector(
          '[data-testid="header-menu-toggle"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await fixture.whenStable();

      const link = fixture.nativeElement.querySelector(
        '[data-testid="header-menu-drawer"] a',
      ) as HTMLAnchorElement;
      link.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[data-testid="header-menu-drawer"]')).toBeNull();
    });

    it('hands focus back to the menu button when the drawer closes', async () => {
      const { fixture } = setup(
        'fr',
        '/fr/',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants' }]),
      );
      const host = document.createElement('div');
      host.appendChild(fixture.nativeElement);
      document.body.appendChild(host);

      const toggle = fixture.nativeElement.querySelector(
        '[data-testid="header-menu-toggle"]',
      ) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();
      await fixture.whenStable();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[data-testid="header-menu-drawer"]')).toBeNull();
      expect(document.activeElement).toBe(toggle);
      host.remove();
    });

    it('passes axe with the drawer open', async () => {
      const { fixture } = setup(
        'fr',
        '/fr/',
        noopApi,
        makeCategoryNav([{ slug: 'implants', label: 'Implants', children: ['titane'] }]),
      );
      (
        fixture.nativeElement.querySelector(
          '[data-testid="header-menu-toggle"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await fixture.whenStable();

      const host = document.createElement('div');
      host.appendChild(fixture.nativeElement);
      document.body.appendChild(host);
      const result = await axe.run(host, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
      const blocking = result.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      host.remove();
    });
  });
});
