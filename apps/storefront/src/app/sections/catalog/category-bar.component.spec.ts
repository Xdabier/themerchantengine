import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoriesService } from '@storefront-services';

import { LocaleService } from '../../locale.service';
import { getChromeStrings } from '../../../i18n';
import { type Locale } from '../../../i18n/types';
import { CategoryBarComponent } from './category-bar.component';
import { fixtureChromeIdentity } from '../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;

  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }

  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  readonly currentUrl = () => `/${this._locale()}/catalog`;
}

const SAMPLE_CATEGORIES = [
  { id: 'cat-1', slug: 'fx-electronics', name: 'Electronics', parentId: null },
  { id: 'cat-2', slug: 'fx-audio', name: 'Audio', parentId: null },
  { id: 'cat-3', slug: 'fx-sub', name: 'Sub', parentId: 'cat-1' },
];

async function render(opts: {
  locale?: Locale;
  activeSlug?: string | null;
  categories?: typeof SAMPLE_CATEGORIES;
  list?: () => Promise<unknown>;
}): Promise<ComponentFixture<CategoryBarComponent>> {
  TestBed.overrideComponent(CategoryBarComponent, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  const list =
    opts.list ??
    (vi.fn(async () => opts.categories ?? SAMPLE_CATEGORIES) as () => Promise<unknown>);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale ?? 'en') },
      { provide: CategoriesService, useValue: { list, getBySlug: vi.fn(), listProducts: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(CategoryBarComponent);
  fixture.componentRef.setInput('activeSlug', opts.activeSlug ?? null);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('CategoryBarComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  function chips(fixture: ComponentFixture<CategoryBarComponent>): HTMLAnchorElement[] {
    const root = fixture.nativeElement as HTMLElement;
    return Array.from(root.querySelectorAll('a.chip')) as HTMLAnchorElement[];
  }

  it('renders the All chip plus a chip per top-level category', async () => {
    const fixture = await render({});
    const list = chips(fixture);
    expect(list.length).toBe(3);
    expect(list[0]!.textContent?.trim()).toBe('All');
    expect(list[1]!.textContent?.trim()).toBe('Electronics');
    expect(list[2]!.textContent?.trim()).toBe('Audio');
  });

  it('marks the All chip active when no slug is supplied', async () => {
    const fixture = await render({ activeSlug: null });
    const all = chips(fixture)[0]!;
    expect(all.classList.contains('is-active')).toBe(true);
    expect(all.getAttribute('aria-current')).toBe('page');
  });

  it('marks the matching slug chip active when activeSlug is set', async () => {
    const fixture = await render({ activeSlug: 'fx-audio' });
    const list = chips(fixture);
    const audio = list.find((c) => c.textContent?.trim() === 'Audio');
    expect(audio?.classList.contains('is-active')).toBe(true);
    expect(audio?.getAttribute('aria-current')).toBe('page');
    expect(list[0]!.classList.contains('is-active')).toBe(false);
  });

  it('filters out non-top-level categories', async () => {
    const fixture = await render({});
    const labels = chips(fixture).map((c) => c.textContent?.trim());
    expect(labels).not.toContain('Sub');
  });

  it('renders only the All chip when the categories fetch fails', async () => {
    const fixture = await render({
      list: () => Promise.reject(new Error('boom')),
    });
    const list = chips(fixture);
    expect(list.length).toBe(1);
    expect(list[0]!.textContent?.trim()).toBe('All');
  });

  it('hides the subcategory strip when no parent is active', async () => {
    const fixture = await render({});
    const subStrip = fixture.nativeElement.querySelector(
      '[data-testid="catalog-category-bar-subs"]',
    );
    expect(subStrip).toBeNull();
  });

  it('renders the subcategory strip when a top-level slug is active', async () => {
    const fixture = await render({ activeSlug: 'fx-electronics' });
    const subList = fixture.nativeElement.querySelector(
      '[data-testid="catalog-category-bar-subs"]',
    ) as HTMLElement | null;
    expect(subList).not.toBeNull();
    const subChips = Array.from(subList!.querySelectorAll('a.chip')) as HTMLAnchorElement[];
    expect(subChips.map((c) => c.textContent?.trim())).toEqual(['Sub']);
    const topChips = chips(fixture).filter((c) => !c.classList.contains('chip--sub'));
    const electronics = topChips.find((c) => c.textContent?.trim() === 'Electronics');
    expect(electronics?.classList.contains('is-active')).toBe(true);
  });

  it('keeps the parent active and highlights the child when a sub slug is active', async () => {
    const fixture = await render({ activeSlug: 'fx-sub' });
    const subList = fixture.nativeElement.querySelector(
      '[data-testid="catalog-category-bar-subs"]',
    ) as HTMLElement | null;
    expect(subList).not.toBeNull();
    const sub = subList!.querySelector('a.chip') as HTMLAnchorElement;
    expect(sub.classList.contains('is-active')).toBe(true);
    expect(sub.getAttribute('aria-current')).toBe('page');
    const topChips = chips(fixture).filter((c) => !c.classList.contains('chip--sub'));
    const electronics = topChips.find((c) => c.textContent?.trim() === 'Electronics');
    expect(electronics?.classList.contains('is-active')).toBe(true);
    expect(electronics?.getAttribute('aria-current')).toBeNull();
  });

  it('flattens children embedded under parent.children', async () => {
    const fixture = await render({
      activeSlug: 'fx-audio',
      categories: [
        {
          id: 'cat-1',
          slug: 'fx-electronics',
          name: 'Electronics',
          parentId: null,
        } as never,
        {
          id: 'cat-2',
          slug: 'fx-audio',
          name: 'Audio',
          parentId: null,
          children: [
            { id: 'cat-4', slug: 'fx-headphones', name: 'Headphones', parentId: 'cat-2' },
            { id: 'cat-5', slug: 'fx-earbuds', name: 'Earbuds', parentId: 'cat-2' },
          ] as never,
        } as never,
      ],
    });
    const subList = fixture.nativeElement.querySelector(
      '[data-testid="catalog-category-bar-subs"]',
    ) as HTMLElement | null;
    expect(subList).not.toBeNull();
    const subChips = Array.from(subList!.querySelectorAll('a.chip')) as HTMLAnchorElement[];
    expect(subChips.map((c) => c.textContent?.trim())).toEqual(['Headphones', 'Earbuds']);
  });
});

describe('CategoryBarComponent — category image thumbnail (B7)', () => {
  const WITH_IMAGE = [
    {
      id: 'cat-1',
      slug: 'fx-electronics',
      name: 'Electronics',
      parentId: null,
      imageUrl: 'https://cdn/cat-400.webp',
      imageVariants: [
        { url: 'https://cdn/cat-400.webp', width: 400, format: 'webp' },
        { url: 'https://cdn/cat-400.avif', width: 400, format: 'avif' },
      ],
    },
    { id: 'cat-2', slug: 'fx-audio', name: 'Audio', parentId: null },
  ];

  it('renders a thumbnail on the chip for a category that has an image', async () => {
    // Operator requirement #3: an uploaded category image must show. The chip
    // bar was text-only, so the upload had no surface here either.
    const fixture = await render({
      categories: WITH_IMAGE as unknown as typeof SAMPLE_CATEGORIES,
    });
    const root = fixture.nativeElement as HTMLElement;
    const chips = Array.from(root.querySelectorAll('a.chip'));
    const withImage = chips.find((c) => c.textContent?.includes('Electronics'))!;
    expect(withImage.querySelector('img')?.getAttribute('src')).toBe('https://cdn/cat-400.webp');
  });

  it('leaves a chip without an image as text only', async () => {
    const fixture = await render({
      categories: WITH_IMAGE as unknown as typeof SAMPLE_CATEGORIES,
    });
    const root = fixture.nativeElement as HTMLElement;
    const chips = Array.from(root.querySelectorAll('a.chip'));
    const withoutImage = chips.find((c) => c.textContent?.includes('Audio'))!;
    expect(withoutImage.querySelector('img')).toBeNull();
  });

  it('keeps the chip label as the accessible name, with the thumbnail decorative', async () => {
    const fixture = await render({
      categories: WITH_IMAGE as unknown as typeof SAMPLE_CATEGORIES,
    });
    const img = (fixture.nativeElement as HTMLElement).querySelector('a.chip img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
