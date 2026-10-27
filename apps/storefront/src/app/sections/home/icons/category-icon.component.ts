import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Inline-SVG category icon. Rounded-line family, 2px stroke, currentColor.
 * `slug` matches the seeded category slugs (`charging`, `audio`, etc.);
 * unknown slugs render the default tag glyph.
 *
 * Brand-floor §6: custom-drawn category icons live here for v1; lucide-angular
 * adoption lands with the S6 catalog phase per clarifications §1.13.
 */
type CategorySlug =
  | 'charging'
  | 'audio'
  | 'watch-accessories'
  | 'home-essentials'
  | 'personal-care'
  // Parent categories the seeded home sections use.
  | 'honey'
  | 'bee-products'
  | 'herbs-supplements'
  | 'skincare'
  | 'haircare'
  | 'accessories'
  | 'default';

@Component({
  selector: 'app-category-icon',
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
      @switch (resolvedSlug()) {
        @case ('charging') {
          <rect x="4" y="6" width="24" height="16" rx="2" />
          <path d="M2 26h28" />
          <path d="M12 26v-4M20 26v-4" />
        }
        @case ('audio') {
          <path d="M5 18a11 11 0 0 1 22 0" />
          <rect x="4" y="18" width="6" height="8" rx="1.5" />
          <rect x="22" y="18" width="6" height="8" rx="1.5" />
        }
        @case ('watch-accessories') {
          <rect x="10" y="9" width="12" height="14" rx="3" />
          <path d="M13 9V5h6v4M13 23v4h6v-4" />
          <circle cx="16" cy="16" r="2.5" />
        }
        @case ('home-essentials') {
          <path d="M4 16 16 5l12 11" />
          <path d="M7 14v12h18V14" />
          <rect x="13" y="18" width="6" height="8" />
        }
        @case ('personal-care') {
          <path d="M12 4h8v6h-8z" />
          <path d="M10 10h12l-2 18H12z" />
          <path d="M14 16h4M14 20h4" />
        }
        @case ('honey') {
          <path d="M11 8h10" />
          <path
            d="M12 8v3l-1.5 1.5A2 2 0 0 0 10 14v9a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-9a2 2 0 0 0-.5-1.5L20 11V8"
          />
          <path d="M16 16v5" />
        }
        @case ('bee-products') {
          <path d="M16 4l9 5.5v11L16 26l-9-5.5v-11z" />
          <circle cx="16" cy="15.5" r="3.5" />
        }
        @case ('herbs-supplements') {
          <path d="M25 6C13 6 7 13 7 25c12 0 18-7 18-19z" />
          <path d="M7 25 19 13" />
        }
        @case ('skincare') {
          <rect x="11" y="12" width="10" height="15" rx="2.5" />
          <path d="M13 12V9h6v3" />
          <path d="M14.5 4h3v5h-3z" />
        }
        @case ('haircare') {
          <path d="M7 9h18v5H7z" />
          <path d="M10 14v9M14 14v9M18 14v9M22 14v9" />
        }
        @case ('accessories') {
          <circle cx="12" cy="11" r="6" />
          <path d="M16 15l8 11" />
        }
        @default {
          <path d="M4 4h12l12 12-12 12L4 16z" />
          <circle cx="11" cy="11" r="2" />
        }
      }
    </svg>
  `,
})
export class CategoryIconComponent {
  readonly slug = input<string>('default');
  readonly size = input<number>(32);

  protected readonly resolvedSlug = computed<CategorySlug>(() => {
    const value = this.slug();
    switch (value) {
      case 'charging':
      case 'audio':
      case 'watch-accessories':
      case 'home-essentials':
      case 'personal-care':
      case 'honey':
      case 'bee-products':
      case 'herbs-supplements':
      case 'skincare':
      case 'haircare':
      case 'accessories':
        return value;
      default:
        return 'default';
    }
  });
}
