import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type SpinnerSize = 16 | 20 | 24 | 32;

@Component({
  selector: 'app-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      role="status"
      [attr.aria-label]="label()"
      [class.text-ink]="true"
      [style.width.px]="size()"
      [style.height.px]="size()"
      class="inline-block bg-surface-elevated"
    ></span>
  `,
})
export class SpinnerComponent {
  readonly size = input<SpinnerSize>(20);
  readonly label = input<string>('Loading');
}
