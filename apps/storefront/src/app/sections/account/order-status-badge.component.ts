import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { OrderStatus } from '@storefront-types';

import { LocaleService } from '../../locale.service';

type Tone = 'pending' | 'progress' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

const STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING: 'pending',
  CONFIRMED: 'progress',
  PROCESSING: 'progress',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  COMPLETED: 'delivered',
  CANCELLED: 'cancelled',
  ON_HOLD: 'pending',
  RETURN_REQUESTED: 'pending',
  RETURNED: 'refunded',
};

@Component({
  selector: 'app-order-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="badge"
      [attr.data-tone]="tone()"
      [attr.data-status]="status()"
      [attr.aria-label]="ariaLabel()"
      [attr.data-testid]="'order-status-badge-' + status()"
    >
      {{ label() }}
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding-block: 0.125rem;
        padding-inline: 0.5rem;
        border-radius: var(--brand-radius-sm);
        font-size: var(--brand-text-micro);
        font-weight: 600;
        line-height: 1.4;
        border: 1px solid currentColor;
      }
      .badge[data-tone='pending'] {
        color: var(--brand-text);
        background-color: var(--brand-surface-strong);
      }
      .badge[data-tone='progress'] {
        color: var(--brand-primary);
        background-color: var(--brand-surface);
      }
      .badge[data-tone='shipped'] {
        color: var(--brand-primary);
        background-color: var(--brand-surface);
      }
      .badge[data-tone='delivered'] {
        color: var(--brand-success-text, var(--brand-primary));
        background-color: var(--brand-surface);
      }
      .badge[data-tone='cancelled'] {
        color: var(--brand-error);
        background-color: var(--brand-surface);
      }
      .badge[data-tone='refunded'] {
        color: var(--brand-text-muted);
        background-color: var(--brand-surface-strong);
      }
    `,
  ],
})
export class OrderStatusBadgeComponent {
  readonly status = input.required<OrderStatus>();

  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;

  protected readonly tone = computed<Tone>(() => STATUS_TONE[this.status()] ?? 'pending');

  protected readonly label = computed(() => {
    const statusStrings = this.strings().account.orders.status;
    switch (this.status()) {
      case 'PENDING':
        return statusStrings.pending;
      case 'CONFIRMED':
        return statusStrings.confirmed;
      case 'PROCESSING':
        return statusStrings.processing;
      case 'SHIPPED':
        return statusStrings.shipped;
      case 'DELIVERED':
      case 'COMPLETED':
        return statusStrings.delivered;
      case 'CANCELLED':
        return statusStrings.cancelled;
      case 'RETURNED':
        return statusStrings.refunded;
      case 'ON_HOLD':
      case 'RETURN_REQUESTED':
        return statusStrings.pending;
      default:
        return this.status();
    }
  });

  protected readonly ariaLabel = computed(() =>
    this.strings().account.orders.row.statusLabel.replace('{status}', this.label()),
  );
}
