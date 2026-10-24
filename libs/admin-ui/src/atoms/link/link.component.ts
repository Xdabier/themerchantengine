import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Brand-styled link. Defaults to underlined on hover with 1.5px thickness.
 * Pass either `to` (internal route) or `href` (external URL). External URLs
 * open in a new tab with rel=noopener by default.
 */
@Component({
  selector: 'app-link',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (to(); as target) {
      <a [routerLink]="target" [class]="rootClass()">
        <ng-content></ng-content>
      </a>
    } @else {
      <a
        [href]="href()"
        [attr.target]="external() ? '_blank' : null"
        [attr.rel]="external() ? 'noopener noreferrer' : null"
        [class]="rootClass()"
      >
        <ng-content></ng-content>
      </a>
    }
  `,
})
export class LinkComponent {
  readonly to = input<string | null | undefined>(undefined);
  readonly href = input<string | null>(null);
  readonly external = input<boolean>(false);
  readonly underline = input<'hover' | 'always' | 'none'>('hover');

  protected rootClass(): string {
    const base =
      'inline-flex items-center gap-1 text-ink text-sm hover:text-ink-emphasis focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2';
    const underlineClass =
      this.underline() === 'always'
        ? 'underline underline-offset-[3px] decoration-[1.5px]'
        : this.underline() === 'hover'
          ? 'hover:underline hover:underline-offset-[3px] hover:decoration-[1.5px]'
          : '';
    return `${base} ${underlineClass}`.trim();
  }
}
