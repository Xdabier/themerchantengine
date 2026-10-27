import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

@Component({
  selector: 'app-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="variantClass()"><ng-content /></span>`,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding-block: 0.125rem;
        padding-inline: 0.5rem;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        line-height: 1.4;
        border-radius: var(--brand-radius-sm);
        white-space: nowrap;
      }
      .v-success {
        background-color: var(--brand-success);
        color: var(--brand-on-functional);
      }
      .v-warning {
        background-color: var(--brand-warning);
        color: var(--brand-on-functional);
      }
      .v-error {
        background-color: var(--brand-error);
        color: var(--brand-on-functional);
      }
      .v-neutral {
        background-color: var(--brand-surface-strong);
        color: var(--brand-text);
      }
    `,
  ],
})
export class BadgeComponent {
  readonly variant = input<BadgeVariant>('neutral');

  protected readonly variantClass = computed(() => `v-${this.variant()}`);
}
