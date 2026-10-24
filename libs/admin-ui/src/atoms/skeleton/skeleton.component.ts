import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Static elevated-surface block for loading placeholders.
 * No shimmer animation — brand mandates no decorative motion.
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      aria-hidden="true"
      class="block bg-surface-elevated"
      [style.width]="width()"
      [style.height]="height()"
    ></span>
  `,
})
export class SkeletonComponent {
  readonly width = input<string>('100%');
  readonly height = input<string>('1em');
}
