import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

const toneClass: Record<BadgeTone, string> = {
  neutral: 'bg-surface-elevated text-ink border-line',
  success: 'bg-status-success-tint text-on-status-success border-status-success',
  warning: 'bg-status-warning-tint text-on-status-warning border-status-warning',
  error: 'bg-status-error-tint text-on-status-error border-status-error',
  info: 'bg-status-info-tint text-on-status-info border-status-info',
};

@Component({
  selector: 'app-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="rootClass()" [attr.role]="resolvedRole()" [attr.aria-label]="ariaLabel()">
      <ng-content></ng-content>
    </span>
  `,
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('neutral');
  /** Optional ARIA role — defaults to 'img' when ariaLabel is set, ensuring
   *  axe rule aria-label-has-accessible-name is satisfied on the host span. */
  readonly role = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);

  /** If caller passes an explicit role, use it. If ariaLabel is set but no
   *  explicit role, fall back to 'img' so the aria-label is valid per ARIA spec. */
  protected resolvedRole(): string | null {
    if (this.role() !== null) return this.role();
    if (this.ariaLabel() !== null) return 'img';
    return null;
  }

  protected rootClass(): string {
    const base =
      'inline-flex items-center px-2 py-0.5 text-[10px] tracking-widest uppercase border';
    return `${base} ${toneClass[this.tone()]}`;
  }
}
