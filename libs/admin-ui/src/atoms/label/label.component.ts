import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-label',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label
      [attr.for]="for()"
      class="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-ink-muted"
    >
      <ng-content></ng-content>
      @if (required()) {
        <span aria-hidden="true" class="text-status-error">*</span>
      }
    </label>
  `,
})
export class LabelComponent {
  readonly for = input<string | null>(null);
  readonly required = input<boolean>(false);
}
