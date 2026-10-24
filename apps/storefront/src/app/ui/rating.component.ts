import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { LocaleService } from '../locale.service';
import { DEFAULT_LOCALE } from '../../i18n/types';
import { getChromeStrings } from '../../i18n';

@Component({
  selector: 'app-rating',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (count() > 0) {
      <div class="rating" role="img" [attr.aria-label]="ariaLabel()">
        @for (idx of stars; track idx) {
          <span class="star" [style.--fill]="fillFor(idx) + '%'" aria-hidden="true">
            <span class="empty">★</span>
            <span class="filled">★</span>
          </span>
        }
        <span class="count" aria-hidden="true">({{ count() }})</span>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .rating {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
      }
      .star {
        position: relative;
        display: inline-block;
        font-size: 16px;
        line-height: 1;
        /* WCAG 1.4.11: the empty-vs-filled distinction is the whole signal, so
           it needs 3:1, and the decorative border token does not reach it on a surface. */
        color: var(--brand-text-muted);
      }
      .star .filled {
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: 0;
        color: var(--brand-text);
        overflow: hidden;
        inline-size: var(--fill, 0%);
      }
      .count {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
    `,
  ],
})
export class RatingComponent {
  readonly value = input<number>(0);
  readonly count = input<number>(0);
  /** Optional override for the aria-label. When omitted, the locale-aware
   * default is computed from the injected LocaleService (French on /fr, English
   * on /en), never the wrong language for the route. */
  readonly labelFormatter = input<((value: number, count: number) => string) | null>(null);

  private readonly localeService = inject(LocaleService, { optional: true });
  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly ariaLabel = computed(() => {
    const formatter = this.labelFormatter();
    if (formatter) return formatter(this.value(), this.count());
    const locale = this.localeService?.locale() ?? DEFAULT_LOCALE;
    // From the catalogue: the `fr`/`en` ternary this replaces read out English
    // to a screen reader on every locale that was not French.
    return getChromeStrings(locale)
      .generic.ratingSummary.replace('{rating}', this.value().toFixed(1))
      .replace('{count}', String(this.count()));
  });

  protected fillFor(starIndex: number): number {
    const value = this.value();
    if (value >= starIndex) return 100;
    if (value <= starIndex - 1) return 0;
    return Math.round((value - (starIndex - 1)) * 100);
  }
}
