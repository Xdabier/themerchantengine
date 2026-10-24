import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { LocaleService } from '../../locale.service';

/**
 * Direction-bearing chevron. Pass `orientation="end"` for forward-pointing
 * arrows; pass `orientation="start"` for back-pointing arrows.
 *
 * Mirrored under an RTL locale (plan E2.3). Logical CSS handles layout, but a
 * glyph is artwork: a chevron drawn pointing right still points right after
 * the box around it flips, and in an RTL page "forward" is left. Only the
 * asymmetric icons carry this; a cart or a magnifier reads the same either
 * way and mirroring one would be wrong.
 */
@Component({
  selector: 'app-chevron-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: inline-flex;
        color: currentColor;
      }
      svg {
        block-size: var(--icon-size);
        inline-size: var(--icon-size);
      }
      :host(.rtl-flip) svg {
        transform: scaleX(-1);
      }
    `,
  ],
  host: {
    '[style.--icon-size.px]': 'size()',
    '[class.rtl-flip]': 'shouldFlip()',
  },
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      aria-hidden="true"
    >
      @if (orientation() === 'end') {
        <path d="m9 6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
      } @else {
        <path d="m15 6-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
      }
    </svg>
  `,
})
export class ChevronIconComponent {
  readonly size = input<number>(20);
  readonly orientation = input<'start' | 'end'>('end');

  private readonly localeService = inject(LocaleService);

  protected readonly shouldFlip = computed(() => this.localeService.direction() === 'rtl');
}
