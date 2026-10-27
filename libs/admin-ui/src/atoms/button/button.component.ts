import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Hover is `enabled:`-scoped throughout: a control that cannot be pressed must
 * not answer the pointer, which is half of why a disabled button read as idle.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-surface-emphasis text-on-emphasis enabled:hover:bg-surface-emphasis-hover',
  secondary: 'bg-surface text-ink border border-ink enabled:hover:bg-surface-elevated',
  destructive:
    'bg-status-error-fill text-on-status-error-fill enabled:hover:bg-surface-elevated enabled:hover:text-ink-emphasis enabled:hover:border enabled:hover:border-status-error',
  ghost: 'bg-transparent text-ink enabled:hover:bg-surface-elevated',
};

/**
 * QA C5: `opacity-50` alone was not an affordance. On the secondary variant it
 * turned the emphasis border into a mid grey indistinguishable from the `--line`
 * chrome, so disabled pagers read as ordinary idle controls and operators kept
 * clicking them. A disabled control is now categorically different: the plain
 * surface, a `--line` border, muted ink, no hover.
 *
 * The text is `--ink-muted` and not `--ink-disabled` on purpose. Those two
 * tokens hold the same pair of neutrals the QA fix chose between, and the
 * dimmer one is exactly what it moved away from.
 */
const disabledClasses =
  'disabled:bg-surface disabled:text-ink-muted disabled:border disabled:border-line disabled:cursor-not-allowed';

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs min-h-[44px]',
  md: 'px-5 py-3 text-sm min-h-[44px]',
  lg: 'px-7 py-4 text-base min-h-[52px]',
};

@Component({
  selector: 'app-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() ? 'true' : null"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-expanded]="ariaExpanded()"
      [attr.aria-controls]="ariaControls()"
      [attr.aria-describedby]="ariaDescribedby()"
      [attr.data-testid]="testId()"
      [class]="rootClass()"
      (click)="clicked.emit($event)"
    >
      @if (loading()) {
        <span aria-hidden="true" class="inline-block h-1 w-3 border-t-2 border-current"></span>
      }
      <ng-content></ng-content>
    </button>
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input<boolean>(false);
  readonly loading = input<boolean>(false);
  readonly fullWidth = input<boolean>(false);
  readonly ariaLabel = input<string | null>(null);
  readonly ariaExpanded = input<boolean | null>(null);
  readonly ariaControls = input<string | null>(null);
  readonly ariaDescribedby = input<string | null>(null);
  readonly testId = input<string | null>(null);

  readonly clicked = output<MouseEvent>();

  protected rootClass(): string {
    const base =
      'inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2';
    return [
      base,
      variantClasses[this.variant()],
      disabledClasses,
      sizeClasses[this.size()],
      this.fullWidth() ? 'w-full' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
}
