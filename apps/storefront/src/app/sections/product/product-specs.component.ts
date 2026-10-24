import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { pickTranslation, type ProductSpec, type ResolvedString } from '@storefront-types';

import { LocaleService } from '../../locale.service';

export interface SpecRow {
  id: string;
  label: string;
  value: string;
}

/**
 * The product specification table.
 *
 * A sibling section rather than part of `product-summary` on purpose: the buy
 * box already stacks brand, title, rating, reference, price, availability,
 * delivery, variants and the CTA, and the measured spec count in this catalogue
 * has a median of 12 rows and a mode of 16. Putting those inside the summary
 * would push add-to-cart off a 360 px screen.
 *
 * Real table markup, not a grid of divs. This is tabular data with a row header
 * per row, so `<th scope="row">` is what lets a screen reader announce "Pression
 * d'air, 0,30 a 0,35 MPa" instead of two unrelated strings.
 *
 * The collapse keeps every row in the DOM and hides the overflow with a class.
 * Rendering only the first N would strip the rest out of the SSR first byte,
 * which costs the crawler the content and costs the customer Ctrl+F.
 */
@Component({
  selector: 'product-specs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length > 0) {
      <section class="specs" [attr.aria-labelledby]="titleId" data-testid="product-specs">
        <h2 [id]="titleId" class="title">{{ strings().product.specs.title }}</h2>

        <div class="scroller">
          <table class="table" [class.collapsed]="isCollapsed()">
            <caption class="sr-only">
              {{
                strings().product.specs.caption
              }}
            </caption>
            <tbody>
              @for (row of rows(); track row.id; let i = $index) {
                <tr
                  class="row"
                  [class.beyond-fold]="i >= collapseAfter"
                  [attr.data-testid]="'product-spec-row'"
                >
                  <th scope="row" class="label">{{ row.label }}</th>
                  <td class="value">{{ row.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (canCollapse()) {
          <button
            type="button"
            class="toggle"
            data-testid="product-specs-toggle"
            [attr.aria-expanded]="!isCollapsed()"
            [attr.aria-controls]="tableId"
            (click)="toggle()"
          >
            {{ toggleLabel() }}
          </button>
        }
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .specs {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .title {
        margin: 0;
        font-family: var(--brand-font-display);
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      /* Wide content scrolls inside its own box. A long value such as
         "280 000 a 350 000 tr/min" must never make the page scroll sideways. */
      .scroller {
        overflow-x: auto;
      }
      .table {
        inline-size: 100%;
        border-collapse: collapse;
        font-size: var(--brand-text-secondary);
      }
      .row {
        border-block-end: 1px solid var(--brand-border);
      }
      .row:last-child {
        border-block-end: none;
      }
      .label {
        inline-size: 42%;
        padding-block: 0.625rem;
        padding-inline-end: 1rem;
        text-align: start;
        font-weight: 500;
        color: var(--brand-text-muted);
        vertical-align: top;
      }
      /* Brand floor 3.2: tabular figures wherever numbers stack, and a spec
         column is the densest stack of numbers on the page. */
      .value {
        padding-block: 0.625rem;
        color: var(--brand-text);
        font-variant-numeric: tabular-nums;
        vertical-align: top;
      }
      .table.collapsed .beyond-fold {
        display: none;
      }
      .toggle {
        align-self: flex-start;
        padding: 0;
        border: none;
        background: none;
        font-size: var(--brand-text-secondary);
        font-weight: 500;
        color: var(--brand-primary);
        text-decoration: underline;
        cursor: pointer;
      }
      .toggle:hover {
        color: var(--brand-primary-dark);
      }
      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    `,
  ],
})
export class ProductSpecsComponent {
  private readonly localeService = inject(LocaleService);

  readonly specs = input<ProductSpec[]>([]);
  /** Stable suffix so two instances never collide on a DOM id. */
  readonly idSuffix = input<string>('product');

  /** Beyond this many rows the table collapses. 8 clears the common 10-to-19 band. */
  protected readonly collapseAfter = 8;

  private readonly collapsed = signal(true);

  protected readonly strings = computed(() => this.localeService.strings());
  protected readonly locale = computed(() => this.localeService.locale());

  protected get titleId(): string {
    return `product-specs-title-${this.idSuffix()}`;
  }

  protected get tableId(): string {
    return `product-specs-table-${this.idSuffix()}`;
  }

  protected readonly rows = computed<SpecRow[]>(() => {
    const locale = this.locale();
    return (this.specs() ?? [])
      .map((spec) => ({
        id: spec.id,
        label: pickTranslation((spec.label ?? null) as ResolvedString | null, locale),
        value: pickTranslation((spec.value ?? null) as ResolvedString | null, locale),
      }))
      .filter((row) => Boolean(row.label) && Boolean(row.value));
  });

  protected readonly canCollapse = computed(() => this.rows().length > this.collapseAfter);
  protected readonly isCollapsed = computed(() => this.canCollapse() && this.collapsed());

  /**
   * Built here rather than in the template: an Angular template has no access
   * to globals, so `String(...)` inside an interpolation fails to compile with
   * "Property 'String' does not exist on type ProductSpecsComponent".
   */
  protected readonly toggleLabel = computed(() => {
    const copy = this.strings().product.specs;
    return this.isCollapsed()
      ? copy.showAll.replace('{count}', `${this.rows().length}`)
      : copy.showLess;
  });

  protected toggle(): void {
    this.collapsed.update((v) => !v);
  }
}
