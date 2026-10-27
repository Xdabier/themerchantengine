import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { LocaleService } from '../../locale.service';
import { StoreConfigService } from '../../services/store-config.service';
import { formatMoney } from '../../../lib/money';

export type CatalogPriceBand = 'under50' | '50to250' | '250to1000' | 'over1000';

/**
 * One filterable specification, as the API derived it from the live catalogue.
 *
 * The rail never decides which specifications are filterable. The API groups the
 * ProductSpec rows and drops the ones that cannot filter, so a specification an
 * operator types today appears here on its own once enough products share it.
 */
export interface CatalogSpecFacet {
  key: string;
  label: string;
  coverage: number;
  values: { valueKey: string; value: string; count: number }[];
}

export interface CatalogFilterState {
  brand: string | null;
  priceBand: CatalogPriceBand | null;
  /** Selected values per specification key. Absent key means nothing selected. */
  specs?: Record<string, string[]>;
}

export interface CatalogFilterChange {
  brand: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceBand: CatalogPriceBand | null;
  /** Flat `key:value` tokens, ready for the API `specs` param. */
  specs: string[];
}

/**
 * The boundaries the bands divide the catalogue at. Amounts, not strings: the
 * currency they are read in comes from the runtime config.
 */
const PRICE_BAND_BOUNDS: Record<CatalogPriceBand, { min: number | null; max: number | null }> = {
  under50: { min: null, max: 50 },
  '50to250': { min: 50, max: 250 },
  '250to1000': { min: 250, max: 1000 },
  over1000: { min: 1000, max: null },
};

/**
 * The upper bound of a band, one display step below the next band's floor, so
 * the bands abut without overlapping.
 *
 * The step is the configured display precision, not a literal. These bounds
 * used to read `49.999`, which is one step below fifty only in a three-decimal
 * currency; in a two-decimal store it left the range `49.99` to `50` with
 * nothing in it, so a product priced at `49.995` fell through every band.
 */
function bandRange(
  band: CatalogPriceBand,
  displayPrecision: number,
): { min: number | null; max: number | null } {
  const bounds = PRICE_BAND_BOUNDS[band];
  if (bounds.max === null) return bounds;
  const step = 10 ** -displayPrecision;
  return { min: bounds.min, max: Number((bounds.max - step).toFixed(displayPrecision)) };
}

@Component({
  selector: 'catalog-filter-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rail" [attr.aria-labelledby]="titleId">
      <h2 [id]="titleId" class="title">{{ strings().catalog.filters.title }}</h2>

      @if (brands().length > 0) {
        <fieldset class="group">
          <legend class="legend">{{ strings().catalog.filters.brand }}</legend>
          <ul class="options" role="list">
            @for (b of brands(); track b) {
              <li>
                <label class="row">
                  <input
                    type="radio"
                    name="brand"
                    [value]="b"
                    [checked]="draftBrand() === b"
                    (change)="setBrand(b)"
                  />
                  <span>{{ b }}</span>
                </label>
              </li>
            }
          </ul>
        </fieldset>
      }

      <fieldset class="group">
        <legend class="legend">{{ strings().catalog.filters.price }}</legend>
        <ul class="options" role="list">
          @for (band of priceBands(); track band.value) {
            <li>
              <label class="row">
                <input
                  type="radio"
                  name="price-band"
                  [value]="band.value"
                  [checked]="draftPriceBand() === band.value"
                  (change)="setPriceBand(band.value)"
                />
                <span>{{ band.label }}</span>
              </label>
            </li>
          }
        </ul>
      </fieldset>

      @for (facet of specFacets(); track facet.key) {
        <details
          class="group spec-group"
          [attr.data-spec-key]="facet.key"
          [open]="selectedCount(facet.key) > 0 ? true : null"
          [attr.open]="selectedCount(facet.key) > 0 ? '' : null"
        >
          <summary class="legend spec-legend">
            {{ facet.label }}
            @if (selectedCount(facet.key) > 0) {
              <span class="count" aria-hidden="true">{{ selectedCount(facet.key) }}</span>
            }
          </summary>
          <ul class="options" role="list" [id]="groupId(facet.key)">
            @for (option of facet.values; track option.valueKey) {
              <li>
                <label class="row">
                  <input
                    type="checkbox"
                    [attr.data-testid]="'spec-' + facet.key + '-' + option.valueKey"
                    [attr.checked]="isSpecChecked(facet.key, option.valueKey) ? '' : null"
                    (change)="toggleSpec(facet.key, option.valueKey)"
                  />
                  <span>{{ option.value }}</span>
                  <span class="count">{{ option.count }}</span>
                </label>
              </li>
            }
          </ul>
        </details>
      }

      <div class="actions">
        <button type="button" class="apply" (click)="apply()">
          {{ strings().catalog.filters.apply }}
        </button>
        <button type="button" class="clear" (click)="clear()">
          {{ strings().catalog.filters.clear }}
        </button>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .rail {
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        padding-block: 1rem;
        padding-inline: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .group {
        border: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .legend {
        padding: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text);
      }
      .options {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      /* Eleven groups is too tall to leave open on a phone, so each one is a
         native <details>. Native rather than a custom disclosure because it
         carries its own expanded state, keyboard handling and screen-reader
         semantics, none of which need reimplementing. */
      .spec-group > .spec-legend {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        cursor: pointer;
        list-style: none;
      }
      .spec-group > .spec-legend::-webkit-details-marker {
        display: none;
      }
      .spec-group > .spec-legend::before {
        content: '+';
        inline-size: 0.75rem;
        color: var(--brand-text-muted);
      }
      .spec-group[open] > .spec-legend::before {
        /* Plain ASCII hyphen, to pair with the '+' above. The literal here used
           to be U+0091, a C1 control character no editor renders, which is how
           it survived review; a CSS numeric escape is not an option because the
           inline styles block is re-parsed as JavaScript under the test JIT. */
        content: '-';
      }
      .spec-group .options {
        margin-block-start: 0.5rem;
      }
      /* A count is a stacked figure, and brand floor 3.2 makes tabular figures
         mandatory wherever numbers stack. */
      .count {
        margin-inline-start: auto;
        font-size: var(--brand-text-micro);
        font-variant-numeric: tabular-nums;
        color: var(--brand-text-muted);
      }
      .row {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        cursor: pointer;
        min-block-size: 44px;
        padding-block: 0.25rem;
      }
      input[type='radio'] {
        inline-size: 20px;
        block-size: 20px;
        accent-color: var(--brand-primary);
        margin: 0;
      }
      input[type='radio']:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
      }
      .apply,
      .clear {
        font: inherit;
        min-block-size: 44px;
        padding-block: 0.5rem;
        padding-inline: 1rem;
        border-radius: var(--brand-radius-md);
        cursor: pointer;
        flex: 1;
      }
      .apply {
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
        border: 1px solid var(--brand-primary);
        /* Declared rather than inherited, so §2.5's 16px floor for white on
           the ring cannot be broken by an ancestor changing its size. */
        font-size: var(--brand-text-body);
      }
      .apply:hover {
        background-color: var(--brand-primary-dark);
        border-color: var(--brand-primary-dark);
      }
      .apply:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .clear {
        background-color: transparent;
        color: var(--brand-primary);
        border: 1px solid var(--brand-primary);
      }
      .clear:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
    `,
  ],
})
export class FilterRailComponent {
  readonly brands = input<string[]>([]);
  readonly initial = input<CatalogFilterState>({ brand: null, priceBand: null, specs: {} });
  readonly specFacets = input<CatalogSpecFacet[]>([]);

  readonly filterChange = output<CatalogFilterChange>();

  protected readonly titleId = `catalog-filter-${++filterRailId}`;

  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  protected readonly strings = computed(() => this.localeService.strings());
  /**
   * The band labels, with their boundaries formatted in the store's money.
   *
   * The copy used to name a currency abbreviation, so every install advertised
   * one former store's unit whatever it actually charged in, and the Arabic
   * catalogue named no unit at all (plan E2.5). The amounts come from
   * `PRICE_BAND_BOUNDS` through `formatMoney`, which is what carries the
   * symbol, its position, the separators and the display precision.
   */
  protected readonly priceBands = computed(() => {
    const s = this.strings().catalog.filters;
    const money = this.storeConfig.money();
    const amount = (value: number): string => formatMoney(value, money);
    const fill = (label: string, band: CatalogPriceBand): string => {
      const bounds = PRICE_BAND_BOUNDS[band];
      return label
        .replace('{min}', bounds.min === null ? '' : amount(bounds.min))
        .replace('{max}', bounds.max === null ? '' : amount(bounds.max));
    };
    return [
      { value: 'under50' as const, label: fill(s.priceUnder50, 'under50') },
      { value: '50to250' as const, label: fill(s.price50to250, '50to250') },
      { value: '250to1000' as const, label: fill(s.price250to1000, '250to1000') },
      { value: 'over1000' as const, label: fill(s.priceOver1000, 'over1000') },
    ];
  });

  protected readonly draftBrand = signal<string | null>(null);
  protected readonly draftPriceBand = signal<CatalogPriceBand | null>(null);
  /** Selected value keys per specification key. */
  protected readonly draftSpecs = signal<Record<string, string[]>>({});
  /** Which specification groups the operator has opened on a narrow screen. */
  protected readonly openGroups = signal<Record<string, boolean>>({});

  ngOnInit(): void {
    const i = this.initial();
    this.draftBrand.set(i.brand);
    this.draftPriceBand.set(i.priceBand);
    this.draftSpecs.set({ ...(i.specs ?? {}) });
  }

  /**
   * Bound with [attr.checked] rather than [checked] in the template.
   *
   * A [checked] property binding sets `el.checked` at runtime and never reaches
   * the serialised SSR HTML, so a deep-linked filter arrived with empty boxes
   * sitting above an already-filtered grid: the customer could see neither what
   * was applied nor how to undo it.
   */
  protected isSpecChecked(key: string, valueKey: string): boolean {
    return (this.draftSpecs()[key] ?? []).includes(valueKey);
  }

  protected toggleSpec(key: string, valueKey: string): void {
    this.draftSpecs.update((current) => {
      const selected = current[key] ?? [];
      const next = selected.includes(valueKey)
        ? selected.filter((v) => v !== valueKey)
        : [...selected, valueKey];
      const copy = { ...current };
      if (next.length) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  }

  protected selectedCount(key: string): number {
    return (this.draftSpecs()[key] ?? []).length;
  }

  protected groupId(key: string): string {
    return `${this.titleId}-spec-${key}`;
  }

  /** Flatten the draft into the `key:value` tokens the API expects. */
  private specTokens(): string[] {
    return Object.entries(this.draftSpecs()).flatMap(([key, values]) =>
      values.map((value) => `${key}:${value}`),
    );
  }

  protected setBrand(brand: string): void {
    this.draftBrand.set(this.draftBrand() === brand ? null : brand);
  }

  protected setPriceBand(band: CatalogPriceBand): void {
    this.draftPriceBand.set(this.draftPriceBand() === band ? null : band);
  }

  protected apply(): void {
    const band = this.draftPriceBand();
    const range = band
      ? bandRange(band, this.storeConfig.money().displayPrecision)
      : { min: null, max: null };
    this.filterChange.emit({
      brand: this.draftBrand(),
      minPrice: range.min,
      maxPrice: range.max,
      priceBand: band,
      specs: this.specTokens(),
    });
  }

  protected clear(): void {
    this.draftBrand.set(null);
    this.draftPriceBand.set(null);
    this.draftSpecs.set({});
    this.filterChange.emit({
      brand: null,
      minPrice: null,
      maxPrice: null,
      priceBand: null,
      specs: [],
    });
  }
}

let filterRailId = 0;
