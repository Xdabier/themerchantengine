import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent, attachToBody } from '../../ui/testing';
import { readStorefrontSource } from '../../../lib/source-text';
import { FilterRailComponent, type CatalogFilterChange } from './filter-rail.component';
import {
  fixtureMoney,
  provideFixtureStoreConfig,
} from '../../../test-support/store-config-fixtures';

describe('FilterRailComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders brand radio rows when brands are provided', async () => {
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: ['Echo', 'Sonic'], initial: { brand: null, priceBand: null } },
      [provideRouter([]), LocaleService],
    );
    const inputs = fixture.nativeElement.querySelectorAll('input[name="brand"]');
    expect(inputs.length).toBe(2);
  });

  it('hides the brand fieldset when no brands provided', async () => {
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: [], initial: { brand: null, priceBand: null } },
      [provideRouter([]), LocaleService],
    );
    const inputs = fixture.nativeElement.querySelectorAll('input[name="brand"]');
    expect(inputs.length).toBe(0);
  });

  it('renders the four price-band radios', async () => {
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: [], initial: { brand: null, priceBand: null } },
      [provideRouter([]), LocaleService],
    );
    const inputs = fixture.nativeElement.querySelectorAll('input[name="price-band"]');
    expect(inputs.length).toBe(4);
  });

  it('emits draft brand + mapped price band on apply', async () => {
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: ['Echo'], initial: { brand: null, priceBand: null } },
      [provideRouter([]), LocaleService],
    );
    let received: CatalogFilterChange | null = null;
    fixture.componentInstance.filterChange.subscribe((c: CatalogFilterChange) => {
      received = c;
    });
    const brandInput = fixture.nativeElement.querySelector(
      'input[name="brand"][value="Echo"]',
    ) as HTMLInputElement;
    brandInput.click();
    fixture.detectChanges();
    const priceBandInput = fixture.nativeElement.querySelector(
      'input[name="price-band"][value="50to250"]',
    ) as HTMLInputElement;
    priceBandInput.click();
    fixture.detectChanges();
    const apply = fixture.nativeElement.querySelector('.apply') as HTMLButtonElement;
    apply.click();
    expect(received).not.toBeNull();
    expect(received).toMatchObject({
      brand: 'Echo',
      minPrice: 50,
      maxPrice: 249.999,
      priceBand: '50to250',
    });
  });

  it('takes the band upper bound from the configured display precision', async () => {
    // The bound is one display step below the next band's floor. Under a
    // two-decimal store that is 249.99; a literal 249.999 would leave a gap
    // that a product priced inside it falls through.
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: [], initial: { brand: null, priceBand: null } },
      [provideRouter([]), LocaleService, provideFixtureStoreConfig('demo')],
    );
    let received: CatalogFilterChange | null = null;
    fixture.componentInstance.filterChange.subscribe((c: CatalogFilterChange) => {
      received = c;
    });
    (
      fixture.nativeElement.querySelector(
        'input[name="price-band"][value="50to250"]',
      ) as HTMLInputElement
    ).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.apply') as HTMLButtonElement).click();

    expect(fixtureMoney('demo').displayPrecision).toBe(2);
    expect(received).toMatchObject({ minPrice: 50, maxPrice: 249.99 });
  });

  it('clear() resets draft state and emits a null payload', async () => {
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: ['Echo'], initial: { brand: 'Echo', priceBand: '50to250' } },
      [provideRouter([]), LocaleService],
    );
    let received: CatalogFilterChange | null = null;
    fixture.componentInstance.filterChange.subscribe((c: CatalogFilterChange) => {
      received = c;
    });
    const clear = fixture.nativeElement.querySelector('.clear') as HTMLButtonElement;
    clear.click();
    expect(received).toEqual({
      brand: null,
      minPrice: null,
      maxPrice: null,
      priceBand: null,
      // Clearing empties the specification selection too, or a cleared rail
      // would keep filtering by whatever was ticked.
      specs: [],
    });
  });

  it('passes axe with labelled fieldsets', async () => {
    const fixture = await renderComponent(
      FilterRailComponent,
      { brands: ['Echo'], initial: { brand: null, priceBand: null } },
      [provideRouter([]), LocaleService],
    );
    const wrapper = attachToBody(fixture.nativeElement);
    await assertAxeClean(wrapper);
  });

  describe('specification facets', () => {
    // The rail never decides which specifications are filterable. The API derives
    // them from the live ProductSpec rows and drops the ones that cannot filter,
    // so these tests only prove the rail renders and reports what it is handed.
    const FACETS = [
      {
        key: 'certification',
        label: 'Certification',
        coverage: 52,
        values: [
          { valueKey: 'ce-iso', value: 'CE ISO', count: 38 },
          { valueKey: 'ce', value: 'CE', count: 10 },
        ],
      },
      {
        key: 'type-de-mandrin',
        label: 'Type de mandrin',
        coverage: 21,
        values: [
          { valueKey: 'bouton-poussoir', value: 'Bouton-poussoir', count: 19 },
          { valueKey: 'loquet', value: 'Loquet', count: 2 },
        ],
      },
    ];

    async function renderWithFacets(initial = { brand: null, priceBand: null, specs: {} }) {
      return renderComponent(FilterRailComponent, {
        brands: [],
        initial,
        specFacets: FACETS,
      });
    }

    it('renders one collapsible group per facet with its option counts', async () => {
      const fixture = await renderWithFacets();
      const groups = fixture.nativeElement.querySelectorAll('.spec-group');
      expect(groups).toHaveLength(2);
      expect(groups[0].getAttribute('data-spec-key')).toBe('certification');
      expect(groups[0].querySelector('.spec-legend')?.textContent).toContain('Certification');
      const boxes = groups[0].querySelectorAll('input[type="checkbox"]');
      expect(boxes).toHaveLength(2);
      expect(groups[0].textContent).toContain('CE ISO');
      expect(groups[0].textContent).toContain('38');
    });

    it('renders no group at all when the API supplies no viable facet', async () => {
      const fixture = await renderComponent(FilterRailComponent, {
        brands: [],
        initial: { brand: null, priceBand: null, specs: {} },
        specFacets: [],
      });
      expect(fixture.nativeElement.querySelectorAll('.spec-group')).toHaveLength(0);
    });

    it('emits OR within one facet: two values on the same key', async () => {
      const fixture = await renderWithFacets();
      let received: unknown = null;
      fixture.componentInstance.filterChange.subscribe((v: unknown) => (received = v));

      (
        fixture.nativeElement.querySelector(
          '[data-testid="spec-certification-ce-iso"]',
        ) as HTMLInputElement
      ).click();
      (
        fixture.nativeElement.querySelector(
          '[data-testid="spec-certification-ce"]',
        ) as HTMLInputElement
      ).click();
      (fixture.nativeElement.querySelector('.apply') as HTMLButtonElement).click();

      expect((received as { specs: string[] }).specs).toEqual([
        'certification:ce-iso',
        'certification:ce',
      ]);
    });

    it('emits AND across facets: one value on each of two keys', async () => {
      const fixture = await renderWithFacets();
      let received: unknown = null;
      fixture.componentInstance.filterChange.subscribe((v: unknown) => (received = v));

      (
        fixture.nativeElement.querySelector(
          '[data-testid="spec-certification-ce-iso"]',
        ) as HTMLInputElement
      ).click();
      (
        fixture.nativeElement.querySelector(
          '[data-testid="spec-type-de-mandrin-loquet"]',
        ) as HTMLInputElement
      ).click();
      (fixture.nativeElement.querySelector('.apply') as HTMLButtonElement).click();

      expect((received as { specs: string[] }).specs.sort()).toEqual([
        'certification:ce-iso',
        'type-de-mandrin:loquet',
      ]);
    });

    it('unticks a value that was already selected', async () => {
      const fixture = await renderWithFacets();
      let received: unknown = null;
      fixture.componentInstance.filterChange.subscribe((v: unknown) => (received = v));
      const box = fixture.nativeElement.querySelector(
        '[data-testid="spec-certification-ce"]',
      ) as HTMLInputElement;
      box.click();
      box.click();
      (fixture.nativeElement.querySelector('.apply') as HTMLButtonElement).click();
      expect((received as { specs: string[] }).specs).toEqual([]);
    });

    it('restores the selection it was handed, so a deep link renders pre-ticked', async () => {
      // Without this a shared filtered URL renders the rail empty while the grid
      // is filtered, and the customer cannot see or undo what is applied.
      const fixture = await renderWithFacets({
        brand: null,
        priceBand: null,
        specs: { certification: ['ce-iso'] },
      });
      const box = fixture.nativeElement.querySelector(
        '[data-testid="spec-certification-ce-iso"]',
      ) as HTMLInputElement;
      expect(box.checked).toBe(true);
    });
  });
});

/**
 * Finding C4 (plan L Phase L4).
 *
 * The expanded-group marker read `content: '2'` in every editor, but the bytes
 * were `C2 91 32`: U+0091, a C1 control character with no glyph, followed by
 * the digit 2. A minus sign was meant. The rule is a CSS escape now, so the
 * source stays ASCII and cannot rot again, and this guard reads the bytes
 * rather than the rendered output because that is the only place the defect
 * was ever visible.
 */
describe('FilterRailComponent source hygiene', () => {
  const source = readStorefrontSource('src/app/sections/catalog/filter-rail.component.ts');

  it('carries no C1 control character', () => {
    const offenders: string[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const code = source.charCodeAt(i);
      if (code >= 0x80 && code <= 0x9f) {
        offenders.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')} at ${i}`);
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('marks the open group with a plain ASCII hyphen', () => {
    expect(source).toContain("content: '-';");
  });
});
