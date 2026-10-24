import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import { SparklineComponent } from '../sparkline/sparkline.component';

export type KpiTone = 'neutral' | 'positive' | 'negative';

/**
 * Brutalist KPI card. Shows a label, a primary value, and an optional trend
 * (sparkline + delta). Loading state renders skeleton bars to keep the grid
 * dimensions stable.
 *
 * No decorative iconography (per brand guide). Delta glyph is a bare `+` or
 * `−` — Lucide icons are reserved for navigation.
 */
@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [SkeletonComponent, SparklineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="border border-line bg-surface p-5 md:p-6 flex flex-col gap-4"
      [attr.data-testid]="testId()"
      [attr.aria-busy]="loading() ? 'true' : null"
    >
      <header class="flex items-baseline justify-between gap-3">
        <p class="text-xs tracking-widest uppercase text-ink-muted">{{ label() }}</p>
        @if (trendPoints().length >= 2 && !loading()) {
          <app-sparkline
            class="text-ink"
            [values]="trendPoints()"
            [ariaLabel]="label() + ' trend'"
            [width]="72"
            [height]="24"
          />
        }
      </header>

      @if (loading()) {
        <app-skeleton [height]="'2.5rem'" [width]="'70%'" />
        <app-skeleton [height]="'0.875rem'" [width]="'35%'" />
      } @else {
        <p class="text-3xl md:text-4xl font-bold text-ink tracking-tight tabular-nums">
          {{ value() }}
        </p>
        @if (delta() !== null) {
          <p
            class="text-xs tabular uppercase tracking-widest"
            [class]="deltaClass()"
            [attr.data-testid]="testId() + '-delta'"
          >
            <span aria-hidden="true">{{ deltaGlyph() }}</span>
            {{ deltaLabel() }}
          </p>
        } @else if (sublabel()) {
          <p class="text-xs tabular text-ink-muted">{{ sublabel() }}</p>
        }
      }
    </article>
  `,
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** Optional delta as a signed percentage (e.g. 12.4 → "+12.4%"). */
  readonly delta = input<number | null>(null);
  readonly tone = input<KpiTone>('neutral');
  /** Optional caption shown in place of the delta when no delta is provided. */
  readonly sublabel = input<string | null>(null);
  readonly trendPoints = input<readonly number[]>([]);
  readonly loading = input<boolean>(false);
  readonly testId = input<string>('kpi-card');

  readonly deltaGlyph = computed(() => {
    const d = this.delta();
    if (d === null || d === 0) return '·';
    return d > 0 ? '+' : '−';
  });

  readonly deltaLabel = computed(() => {
    const d = this.delta();
    if (d === null) return '';
    const abs = Math.abs(d).toFixed(1).replace(/\.0$/, '');
    return `${abs}% vs prior period`;
  });

  readonly deltaClass = computed(() => {
    if (this.tone() === 'positive') return 'text-status-success';
    if (this.tone() === 'negative') return 'text-status-error';
    const d = this.delta();
    if (d === null || d === 0) return 'text-ink-muted';
    return d > 0 ? 'text-status-success' : 'text-status-error';
  });
}
