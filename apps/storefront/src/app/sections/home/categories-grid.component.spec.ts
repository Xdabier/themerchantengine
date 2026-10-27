import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import type { Category } from '@storefront-types';

import { CategoriesGridComponent } from './categories-grid.component';
import { LocaleService } from '../../locale.service';
import { getChromeStrings } from '../../../i18n';
import type { Locale } from '../../../i18n/types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('fr');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = signal('/fr/').asReadonly();
  readonly strings = signal(getChromeStrings('fr'));
}

function setup(categories: Category[]) {
  TestBed.configureTestingModule({
    imports: [CategoriesGridComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: new FakeLocaleService() },
    ],
  });
  const fixture = TestBed.createComponent(CategoriesGridComponent);
  fixture.componentRef.setInput('categories', categories);
  fixture.detectChanges();
  return { fixture };
}

function category(overrides: Partial<Record<string, unknown>> = {}): Category {
  return {
    id: 'cat-1',
    slug: 'instruments-rotatifs',
    name: { default: 'Instruments', en: 'Instruments', fr: 'Instruments' },
    parentId: null,
    children: [],
    ...overrides,
  } as unknown as Category;
}

const VARIANTS = [
  { url: 'https://cdn/cat-400.webp', width: 400, format: 'webp' as const },
  { url: 'https://cdn/cat-400.avif', width: 400, format: 'avif' as const },
];

describe('CategoriesGridComponent', () => {
  it('renders the uploaded category image when the API resolved one', () => {
    // S5 / H4: the tile only ever drew a glyph, so an image uploaded in the
    // admin never reached a customer.
    const { fixture } = setup([
      category({ imageUrl: 'https://cdn/cat-400.webp', imageVariants: VARIANTS }),
    ]);
    const tile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-category-instruments-rotatifs"]',
    )!;
    const img = tile.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn/cat-400.webp');
    expect(tile.querySelector('app-category-icon')).toBeNull();
  });

  it('negotiates the image format through the variant ladder', () => {
    const { fixture } = setup([
      category({ imageUrl: 'https://cdn/cat-400.webp', imageVariants: VARIANTS }),
    ]);
    const types = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('source')).map(
      (s) => s.getAttribute('type'),
    );
    expect(types).toContain('image/avif');
    expect(types).toContain('image/webp');
  });

  it('keeps the drawn glyph for a category with no image', () => {
    const { fixture } = setup([category({ imageUrl: null })]);
    const tile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-category-instruments-rotatifs"]',
    )!;
    expect(tile.querySelector('app-category-icon')).not.toBeNull();
    expect(tile.querySelector('img')).toBeNull();
  });

  it('keeps the generic glyph for an unknown slug with no image', () => {
    const { fixture } = setup([category({ slug: 'not-a-known-slug', imageUrl: null })]);
    const tile = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="home-category-not-a-known-slug"]',
    )!;
    expect(tile.querySelector('app-category-icon')).not.toBeNull();
  });

  it('leaves the tile label as the accessible name, with the media decorative', () => {
    // The media area is inside an aria-hidden span, so the image must carry an
    // empty alt: a described image plus the label would name the link twice.
    const { fixture } = setup([
      category({ imageUrl: 'https://cdn/cat-400.webp', imageVariants: VARIANTS }),
    ]);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(root.querySelector('.label')?.textContent?.trim()).toBe('Instruments');
  });

  it('passes axe-core WCAG 2.2 AA with an image tile', async () => {
    const { fixture } = setup([
      category({ imageUrl: 'https://cdn/cat-400.webp', imageVariants: VARIANTS }),
    ]);
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
