import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { LocaleService } from '../../locale.service';
import {
  CATALOG_SORT_MAP,
  DEFAULT_CATALOG_SORT_KEY,
  type CatalogSortKey,
} from '../../../lib/catalog-sort';

// The key type and the key-to-query map live in `lib/catalog-sort` so the
// select and the four query builders read ONE table. They used to be declared
// here and re-derived in each builder, which is how the control could show
// "Newest" over a request that carried no sort at all (finding C7).
export type { CatalogSortKey } from '../../../lib/catalog-sort';

export interface CatalogSortChange {
  key: CatalogSortKey;
  sortBy: 'createdAt' | 'price' | 'name';
  sortOrder: 'asc' | 'desc';
}

@Component({
  selector: 'catalog-sort-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label class="label" [for]="id">{{ strings().catalog.sort.label }}</label>
      <div class="control">
        <select [id]="id" (change)="onChange($event)">
          @for (option of options(); track option.value) {
            <option [value]="option.value" [selected]="option.value === current()">
              {{ option.label }}
            </option>
          }
        </select>
        <span class="chevron" aria-hidden="true">▾</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-inline-size: 280px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .label {
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text);
      }
      .control {
        position: relative;
      }
      select {
        appearance: none;
        inline-size: 100%;
        min-block-size: 44px;
        padding-block: 0.625rem;
        padding-inline-start: 0.875rem;
        padding-inline-end: 2.25rem;
        font: inherit;
        color: var(--brand-text);
        background-color: var(--brand-surface);
        /* agent_docs/storefront/brand-tokens.md: a control's resting boundary is load-bearing. */
        border: 1px solid var(--brand-border-interactive);
        border-radius: var(--brand-radius-md);
      }
      select:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 1px;
        border-color: var(--brand-primary);
      }
      .chevron {
        position: absolute;
        inset-inline-end: 0.75rem;
        inset-block-start: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
    `,
  ],
})
export class SortControlComponent {
  readonly current = input<CatalogSortKey>('newest');

  readonly sortChange = output<CatalogSortChange>();

  protected readonly id = `catalog-sort-${++sortControlId}`;

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());
  protected readonly options = computed(() => {
    const s = this.strings().catalog.sort;
    return [
      { value: 'newest', label: s.newest },
      { value: 'priceAsc', label: s.priceAsc },
      { value: 'priceDesc', label: s.priceDesc },
      { value: 'nameAsc', label: s.nameAsc },
    ];
  });

  protected onChange(event: Event): void {
    const key = (event.target as HTMLSelectElement).value as CatalogSortKey;
    const mapped = CATALOG_SORT_MAP[key] ?? CATALOG_SORT_MAP[DEFAULT_CATALOG_SORT_KEY];
    this.sortChange.emit({ key, sortBy: mapped.sortBy, sortOrder: mapped.sortOrder });
  }
}

let sortControlId = 0;
