import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 32 };

@Component({
  selector: 'app-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="spinner"
      role="status"
      [attr.aria-label]="label()"
      [style.--spinner-size.px]="px()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" />
      </svg>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
      }

      .spinner {
        --spinner-size: 24px;
        display: inline-block;
        inline-size: var(--spinner-size);
        block-size: var(--spinner-size);
      }

      svg {
        inline-size: 100%;
        block-size: 100%;
        animation: spinner-rotate 800ms linear infinite;
      }

      circle {
        fill: none;
        stroke: currentColor;
        stroke-width: 3;
        stroke-linecap: round;
        stroke-dasharray: 47;
        stroke-dashoffset: 32;
        transform-origin: center;
      }

      @keyframes spinner-rotate {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        svg {
          animation-duration: 1.6s;
        }
        circle {
          stroke-dashoffset: 24;
        }
      }
    `,
  ],
})
export class SpinnerComponent {
  readonly size = input<SpinnerSize>('md');
  readonly label = input<string>('Loading');

  protected readonly px = computed(() => SIZE_PX[this.size()]);
}
