import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Brutalist sparkline — single SVG polyline, monoline (1.5px), no fill, no
 * animation. Renders nothing when fewer than 2 points are available so the
 * KPI card can substitute its own empty state.
 *
 * Contract per brand guide: no decorative strokes, no gradient, no
 * scroll-triggered reveal — the line shows up instantly on render.
 */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasData()) {
      <svg
        class="block"
        [attr.width]="width()"
        [attr.height]="height()"
        [attr.viewBox]="viewBox()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        preserveAspectRatio="none"
      >
        <polyline
          [attr.points]="points()"
          fill="none"
          [attr.stroke]="stroke()"
          stroke-width="1.5"
          stroke-linecap="square"
          stroke-linejoin="miter"
        />
      </svg>
    }
  `,
})
export class SparklineComponent {
  readonly values = input.required<readonly number[]>();
  readonly width = input<number>(120);
  readonly height = input<number>(32);
  readonly stroke = input<string>('currentColor');
  readonly ariaLabel = input<string>('Trend');

  readonly hasData = computed(() => this.values().length >= 2);

  readonly viewBox = computed(() => `0 0 ${this.width()} ${this.height()}`);

  /**
   * Map values to `x,y` pairs inside the viewBox. Flat lines render at the
   * vertical midpoint (so "zero change" still shows a horizontal trace).
   */
  readonly points = computed(() => {
    const values = this.values();
    if (values.length < 2) return '';
    const w = this.width();
    const h = this.height();
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const dx = w / (values.length - 1);

    return values
      .map((v, i) => {
        const x = i * dx;
        const y = range === 0 ? h / 2 : h - ((v - min) / range) * h;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });
}
