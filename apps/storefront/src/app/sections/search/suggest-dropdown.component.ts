import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { SuggestItem } from '@storefront-types';

import { LocaleService } from '../../locale.service';

/**
 * Dropdown surface for the header search combobox. Pure presentation —
 * the host (`HeaderComponent`) owns timing, fetching, abort control,
 * keyboard state (Esc / Tab / outside-click dismissal). The dropdown only:
 *
 * - paints the listbox + status rows,
 * - mirrors `aria-selected` against `activeIndex`,
 * - emits `select` (an item or the literal `'view-all'`) on click,
 * - emits `activate(index)` on hover so keyboard + pointer agree.
 *
 * The combobox a11y semantics live on the host's `<input>` per
 * WAI-ARIA 1.2 §3.4 — the dropdown is the listbox referenced by
 * `aria-controls`. Loading + empty status rows render as siblings of
 * the listbox container, not children, so the `aria-required-children`
 * rule (listbox owns only `role="option"` / `role="group"` /
 * `role="presentation"`) holds during transient states.
 */
export type SuggestSelectPayload =
  | { kind: 'item'; item: SuggestItem; index: number }
  | { kind: 'view-all' };

@Component({
  selector: 'app-suggest-dropdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      @if (isLoading()) {
        <div class="status" role="status" data-testid="suggest-loading">
          {{ strings().search.loading }}
        </div>
      } @else if (items().length === 0) {
        <div class="status" role="status" data-testid="suggest-empty">
          {{ strings().search.noSuggestions }}
        </div>
      } @else {
        <div
          class="dropdown"
          [attr.id]="listboxId()"
          role="listbox"
          [attr.aria-label]="strings().search.suggestionsLabel"
        >
          @for (it of items(); track itemKey(it, $index); let i = $index) {
            <div
              class="option"
              role="option"
              tabindex="-1"
              [attr.id]="optionId(i)"
              [attr.aria-selected]="i === activeIndex()"
              [class.active]="i === activeIndex()"
              (mousedown)="onMouseDown($event)"
              (mouseenter)="activate.emit(i)"
              (click)="onItemClick(it, i)"
              data-testid="suggest-option"
            >
              <span class="label">{{ it.label }}</span>
            </div>
          }
          @if (query().length > 0) {
            <div
              class="option view-all"
              role="option"
              tabindex="-1"
              [attr.id]="optionId(items().length)"
              [attr.aria-selected]="activeIndex() === items().length"
              [class.active]="activeIndex() === items().length"
              (mousedown)="onMouseDown($event)"
              (mouseenter)="activate.emit(items().length)"
              (click)="onViewAllClick()"
              data-testid="suggest-view-all"
            >
              {{ viewAllLabel() }}
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset-inline-start: 0;
        inset-inline-end: 0;
        inset-block-start: 100%;
        z-index: 20;
      }
      .shell {
        margin-block-start: 0.25rem;
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border-strong);
        border-radius: var(--brand-radius-md);
        overflow: hidden;
      }
      .dropdown {
        display: block;
      }
      .option,
      .status {
        display: block;
        inline-size: 100%;
        min-block-size: 44px;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        font: inherit;
        color: var(--brand-text);
        background: transparent;
        border: none;
        text-align: start;
        cursor: pointer;
      }
      .status {
        cursor: default;
        color: var(--brand-text-muted);
      }
      .option:hover,
      .option.active {
        background-color: var(--brand-surface-strong);
      }
      .option:focus-visible {
        background-color: var(--brand-surface-strong);
        outline: 2px solid var(--brand-focus);
        outline-offset: -2px;
      }
      .view-all {
        font-weight: 500;
        color: var(--brand-primary);
        border-block-start: 1px solid var(--brand-border);
      }
    `,
  ],
})
export class SuggestDropdownComponent {
  readonly items = input.required<SuggestItem[]>();
  readonly query = input.required<string>();
  readonly activeIndex = input<number>(-1);
  readonly isLoading = input<boolean>(false);
  readonly listboxId = input.required<string>();

  readonly select = output<SuggestSelectPayload>();
  readonly activate = output<number>();

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());
  protected readonly viewAllLabel = computed(() =>
    this.strings().search.viewAllResults.replace('{q}', this.query()),
  );

  protected itemKey(item: SuggestItem, index: number): string {
    return item.productId ?? item.slug ?? `${index}-${item.label}`;
  }

  protected optionId(index: number): string {
    return `${this.listboxId()}-option-${index}`;
  }

  /**
   * `mousedown` on the option fires before `blur` on the input. Without
   * `preventDefault()`, the input loses focus, the host's blur handler
   * collapses the dropdown, and the click is swallowed before it can
   * reach `onItemClick`.
   */
  protected onMouseDown(event: MouseEvent): void {
    event.preventDefault();
  }

  protected onItemClick(item: SuggestItem, index: number): void {
    this.select.emit({ kind: 'item', item, index });
  }

  protected onViewAllClick(): void {
    this.select.emit({ kind: 'view-all' });
  }
}
