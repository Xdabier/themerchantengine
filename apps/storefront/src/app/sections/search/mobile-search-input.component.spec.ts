import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { MobileSearchInputComponent } from './mobile-search-input.component';
import { LocaleService } from '../../locale.service';
import { STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';
import { getChromeStrings } from '../../../i18n';
import type { Locale } from '../../../i18n/types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('en');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = signal('/en/search').asReadonly();
  readonly strings = signal(getChromeStrings('en'));
  set(locale: Locale) {
    this._locale.set(locale);
    this.strings.set(getChromeStrings(locale));
  }
}

const noopApi: ApiClient = {
  get: async () => ({}) as never,
  post: async () => ({}) as never,
  patch: async () => ({}) as never,
  delete: async () => ({}) as never,
  request: async () => ({}) as never,
};

function setup(initialQuery: string | null = null) {
  const fakeLocale = new FakeLocaleService();
  TestBed.configureTestingModule({
    imports: [MobileSearchInputComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: fakeLocale },
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
    ],
  });
  const fixture = TestBed.createComponent(MobileSearchInputComponent);
  fixture.componentRef.setInput('initialQuery', initialQuery);
  fixture.detectChanges();
  return { fixture, router: TestBed.inject(Router) };
}

describe('MobileSearchInputComponent', () => {
  it('hides itself at the desktop breakpoint via @media (min-width: 768px)', () => {
    const { fixture } = setup(null);
    const styleEls = Array.from(
      fixture.nativeElement.getRootNode() instanceof Document
        ? (fixture.nativeElement.getRootNode() as Document).querySelectorAll('style')
        : [],
    ) as HTMLStyleElement[];
    const css = styleEls.map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/@media\s*\(\s*min-width:\s*768px\s*\)/);
    // Angular view-encapsulation rewrites :host to a generated [_nghost-…]
    // attribute selector. Match either form. The `display: none` rule lives
    // inside the @media block, so check for the rule presence after the
    // breakpoint declaration.
    const mediaSection = css.split(/@media\s*\(\s*min-width:\s*768px\s*\)/)[1] ?? '';
    expect(mediaSection).toMatch(/display:\s*none/);
  });

  it('pre-fills the input from initialQuery', () => {
    const { fixture } = setup('phones');
    const input = fixture.nativeElement.querySelector(
      '[data-testid="mobile-search-input"]',
    ) as HTMLInputElement;
    expect(input.value).toBe('phones');
  });

  it('exposes the combobox a11y wiring per WAI-ARIA 1.2', () => {
    const { fixture } = setup(null);
    const input = fixture.nativeElement.querySelector(
      '[data-testid="mobile-search-input"]',
    ) as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-controls')).toBe('mobile-search-listbox');
  });

  it('navigates to /<locale>/search?q=... on submit with a non-empty query', () => {
    const { fixture, router } = setup(null);
    const input = fixture.nativeElement.querySelector(
      '[data-testid="mobile-search-input"]',
    ) as HTMLInputElement;
    input.value = 'tablet';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

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
      extras: { queryParams: { q: 'tablet' } },
    });
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const { fixture } = setup('phones');
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
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
});

/**
 * Finding C8, mobile half (plan L Phase L3).
 *
 * Same defect and same fix as the header combobox: suggestions arrived with the
 * first item already highlighted, so Enter followed it instead of searching
 * what the shopper typed.
 */
describe('MobileSearchInputComponent Enter contract', () => {
  const SUGGESTIONS = [
    { type: 'product', label: 'Phone case', slug: 'phone-case' },
    { type: 'product', label: 'Tablet', slug: 'tablet' },
  ];

  function setupWithSuggestions() {
    const fakeLocale = new FakeLocaleService();
    const api: ApiClient = {
      ...noopApi,
      get: async () => ({ data: SUGGESTIONS }) as never,
    };
    TestBed.configureTestingModule({
      imports: [MobileSearchInputComponent],
      providers: [
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideRouter([]),
        { provide: LocaleService, useValue: fakeLocale },
        { provide: STOREFRONT_API_CLIENT, useValue: api },
      ],
    });
    const fixture = TestBed.createComponent(MobileSearchInputComponent);
    fixture.componentRef.setInput('initialQuery', null);
    fixture.detectChanges();
    return { fixture, router: TestBed.inject(Router) };
  }

  async function typeAndSettle(fixture: ReturnType<typeof setupWithSuggestions>['fixture']) {
    const input = fixture.nativeElement.querySelector(
      '[data-testid="mobile-search-input"]',
    ) as HTMLInputElement;
    input.value = 'pho';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Past the 200 ms suggest debounce, then let the fetch settle.
    await new Promise((resolve) => setTimeout(resolve, 260));
    await fixture.whenStable();
    fixture.detectChanges();
    return input;
  }

  it('leaves nothing active when suggestions arrive', async () => {
    const { fixture } = setupWithSuggestions();
    const input = await typeAndSettle(fixture);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(null);
  });

  it('Enter with nothing arrowed to submits the typed query', async () => {
    const { fixture, router } = setupWithSuggestions();
    const input = await typeAndSettle(fixture);

    let captured: unknown = null;
    (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
      captured = { commands, extras };
      return Promise.resolve(true);
    };
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(captured).toBeNull();

    // jsdom does not translate Enter into a submit, so the spec drives the
    // form's own handler to prove where an unswallowed Enter lands.
    const form = fixture.nativeElement.querySelector('form.search') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(captured).toEqual({
      commands: ['/en/search'],
      extras: { queryParams: { q: 'pho' } },
    });
  });

  it('ArrowDown then Enter still commits the first suggestion', async () => {
    const { fixture, router } = setupWithSuggestions();
    const input = await typeAndSettle(fixture);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    fixture.detectChanges();
    expect(input.getAttribute('aria-activedescendant')).toContain('option-0');

    let captured: unknown = null;
    (router as unknown as { navigate: typeof router.navigate }).navigate = (commands, extras) => {
      captured = { commands, extras };
      return Promise.resolve(true);
    };
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enter);
    fixture.detectChanges();
    expect(enter.defaultPrevented).toBe(true);
    expect(captured).toEqual({
      commands: ['/en/catalog/product/phone-case'],
      extras: undefined,
    });
  });
});
