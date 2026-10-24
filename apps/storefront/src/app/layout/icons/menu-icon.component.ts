import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Line-weight menu glyph, brand floor §6. Decorative: the button that holds
 * it carries the accessible name. */
@Component({
  selector: 'app-menu-icon',
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
  host: {
    '[style.--icon-size.px]': 'size()',
  },
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  `,
})
export class MenuIconComponent {
  readonly size = input<number>(22);
}
