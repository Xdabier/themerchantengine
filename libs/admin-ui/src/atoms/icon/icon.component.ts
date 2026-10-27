import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

export type IconSize = 16 | 20 | 24;

/**
 * Brand-compliant icon wrapper. Lucide is the only allowed icon library.
 * Stroke width 1.5–2 px (Lucide default is 2; we lock to 1.75).
 * If an icon requires a label to be understood, use a plain text label instead.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <lucide-icon
      [name]="name()"
      [size]="size()"
      [strokeWidth]="1.75"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.aria-label]="label()"
      [attr.role]="label() ? 'img' : null"
    ></lucide-icon>
  `,
})
export class IconComponent {
  readonly name = input.required<LucideIconData | string>();
  readonly size = input<IconSize>(20);
  /** Set only when the icon is not paired with a visible text label. */
  readonly label = input<string | null>(null);
}
