import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-cart-icon',
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
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      aria-hidden="true"
    >
      <path
        d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle cx="10" cy="20" r="1.25" fill="currentColor" />
      <circle cx="17" cy="20" r="1.25" fill="currentColor" />
    </svg>
  `,
})
export class CartIconComponent {
  readonly size = input<number>(20);
}
