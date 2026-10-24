import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-globe-icon',
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
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke-linecap="round" />
    </svg>
  `,
})
export class GlobeIconComponent {
  readonly size = input<number>(20);
}
