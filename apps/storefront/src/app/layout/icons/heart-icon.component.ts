import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Heart icon for the wishlist toggle. Two visual states are driven by the
 * `filled` input: outline (not in wishlist) and solid fill (in wishlist).
 * Brand-floor §10 — feature icons share the same family + stroke weight as
 * the cart / search / account / globe icons that already shipped.
 */
@Component({
  selector: 'app-heart-icon',
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
    `,
  ],
  host: { '[style.--icon-size.px]': 'size()' },
  template: `
    <svg
      viewBox="0 0 24 24"
      [attr.fill]="filled() ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="1.75"
      aria-hidden="true"
    >
      <path
        d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class HeartIconComponent {
  readonly size = input<number>(20);
  readonly filled = input<boolean>(false);
}
