import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Inline-SVG trust pillar icon. Same rounded-line family as the layout icons
 * (2px stroke, currentColor). Pillars: delivery / returns / authentic /
 * support — keyed by `kind`.
 */
type TrustKind = 'delivery' | 'returns' | 'authentic' | 'support';

@Component({
  selector: 'app-trust-icon',
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
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (kind()) {
        @case ('delivery') {
          <path d="M3 8h14v14H3z" />
          <path d="M17 12h7l5 5v5h-12z" />
          <circle cx="9" cy="24" r="3" />
          <circle cx="22" cy="24" r="3" />
        }
        @case ('returns') {
          <path d="M5 16a11 11 0 1 0 4-8.5" />
          <path d="M3 4v6h6" />
        }
        @case ('authentic') {
          <path d="M16 4 5 8v8c0 7 5 11 11 12 6-1 11-5 11-12V8z" />
          <path d="M11 16l4 4 6-7" />
        }
        @case ('support') {
          <path d="M5 19v-3a11 11 0 0 1 22 0v3" />
          <rect x="3" y="19" width="6" height="8" rx="2" />
          <rect x="23" y="19" width="6" height="8" rx="2" />
          <path d="M21 27c0 2-2 3-5 3" />
        }
      }
    </svg>
  `,
})
export class TrustIconComponent {
  readonly kind = input.required<TrustKind>();
  readonly size = input<number>(28);
}
