import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { LocaleService } from '../locale.service';
import { DEFAULT_LOCALE } from '../../i18n/types';
import { getChromeStrings } from '../../i18n';

export type PaginationVariant = 'mobile' | 'desktop';

@Component({
  selector: 'app-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="resolvedAriaLabel()" class="pager" [class]="variantClass()">
      <button
        type="button"
        class="step prev"
        [disabled]="page() <= 1"
        (click)="goto(page() - 1)"
        [attr.aria-label]="resolvedPrevLabel()"
      >
        <span aria-hidden="true">‹</span>
        <span class="step-text">{{ resolvedPrevLabel() }}</span>
      </button>

      @if (variant() === 'desktop') {
        <ul class="pages" role="list">
          @for (p of pages(); track p) {
            <li>
              @if (p === '…') {
                <span class="ellipsis" aria-hidden="true">…</span>
              } @else {
                <button
                  type="button"
                  class="page"
                  [class.active]="p === page()"
                  [attr.aria-current]="p === page() ? 'page' : null"
                  (click)="goto(+p)"
                >
                  {{ p }}
                </button>
              }
            </li>
          }
        </ul>
      } @else {
        <span class="summary">{{ summaryLabel() }}</span>
      }

      <button
        type="button"
        class="step next"
        [disabled]="page() >= totalPages()"
        (click)="goto(page() + 1)"
        [attr.aria-label]="resolvedNextLabel()"
      >
        <span class="step-text">{{ resolvedNextLabel() }}</span>
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .pager {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .step {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        min-block-size: 44px;
        padding-block: 0.5rem;
        padding-inline: 0.875rem;
        background: transparent;
        color: var(--brand-primary);
        border: 1px solid var(--brand-border-strong);
        border-radius: var(--brand-radius-md);
        cursor: pointer;
        font: inherit;
      }
      .step:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .step:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .step-text {
        display: none;
      }
      .desktop .step-text {
        display: inline;
      }
      .pages {
        display: inline-flex;
        gap: 0.25rem;
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .page {
        min-inline-size: 44px;
        min-block-size: 44px;
        background: transparent;
        color: var(--brand-text);
        border: 1px solid transparent;
        border-radius: var(--brand-radius-md);
        cursor: pointer;
        font: inherit;
      }
      .page:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .page.active {
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
        font-weight: 600;
        /* Declared rather than inherited, so §2.5's 16px floor for white on
           the ring cannot be broken by an ancestor changing its size. */
        font-size: var(--brand-text-body);
      }
      .page.active:hover {
        background-color: var(--brand-primary-dark);
      }
      .ellipsis {
        padding-inline: 0.5rem;
      }
      .summary {
        flex: 1;
        text-align: center;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
    `,
  ],
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly variant = input<PaginationVariant>('desktop');
  /** Optional overrides — when omitted, the LocaleService-aware defaults
   * compute the correct French/English string per route prefix. */
  readonly ariaLabel = input<string | null>(null);
  readonly prevLabel = input<string | null>(null);
  readonly nextLabel = input<string | null>(null);
  readonly summaryFormatter = input<((page: number, total: number) => string) | null>(null);

  readonly pageChange = output<number>();

  private readonly localeService = inject(LocaleService, { optional: true });
  private readonly locale = computed(() => this.localeService?.locale() ?? DEFAULT_LOCALE);

  protected readonly variantClass = computed(() => this.variant());
  // "Pagination" is the same word in both locales, so there is no branch here.
  protected readonly resolvedAriaLabel = computed(() => this.ariaLabel() ?? 'Pagination');
  // From the catalogue, not a `fr`/`en` ternary: the ternary rendered English
  // on every locale that was not French, so an Arabic page silently shipped
  // English chrome under a perfectly valid 200.
  private readonly generic = computed(() => getChromeStrings(this.locale()).generic);
  protected readonly resolvedPrevLabel = computed(
    () => this.prevLabel() ?? this.generic().paginationPrevious,
  );
  protected readonly resolvedNextLabel = computed(
    () => this.nextLabel() ?? this.generic().paginationNext,
  );
  protected readonly summaryLabel = computed(() => {
    const formatter = this.summaryFormatter();
    if (formatter) return formatter(this.page(), this.totalPages());
    return this.generic()
      .paginationSummary.replace('{page}', String(this.page()))
      .replace('{total}', String(this.totalPages()));
  });

  protected readonly pages = computed<(number | '…')[]>(() => {
    const total = this.totalPages();
    const cur = this.page();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const window: (number | '…')[] = [1];
    const start = Math.max(2, cur - 1);
    const end = Math.min(total - 1, cur + 1);
    if (start > 2) window.push('…');
    for (let i = start; i <= end; i++) window.push(i);
    if (end < total - 1) window.push('…');
    window.push(total);
    return window;
  });

  protected goto(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) return;
    this.pageChange.emit(page);
  }
}
