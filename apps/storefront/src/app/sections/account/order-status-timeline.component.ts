import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import type { OrderStatus } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { LOCALE_INTL_TAG } from '../../../i18n/types';
import { OrderStatusBadgeComponent } from './order-status-badge.component';

export interface OrderTimelineEvent {
  status: OrderStatus;
  at: string;
  note?: string | null;
}

@Component({
  selector: 'app-order-status-timeline',
  standalone: true,
  imports: [OrderStatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="timeline"
      aria-labelledby="order-status-timeline-title"
      data-testid="order-status-timeline"
    >
      <h2 id="order-status-timeline-title" class="title">
        {{ strings().account.orderDetail.timeline.title }}
      </h2>
      <ol class="events">
        @for (event of events(); track event.at + event.status) {
          <li class="event" [attr.data-status]="event.status">
            <span class="dot" aria-hidden="true"></span>
            <div class="content">
              <app-order-status-badge [status]="event.status" />
              <time class="at" [attr.datetime]="event.at">{{ formatTime(event.at) }}</time>
              @if (event.note) {
                <p class="note">{{ event.note }}</p>
              }
            </div>
          </li>
        }
      </ol>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .title {
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
        margin-block-end: 0.75rem;
      }
      .events {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        position: relative;
      }
      .event {
        display: grid;
        grid-template-columns: 1.25rem 1fr;
        gap: 0.75rem;
        align-items: start;
        position: relative;
      }
      .event:not(:last-child)::before {
        content: '';
        position: absolute;
        inset-block-start: 1.25rem;
        inset-inline-start: 0.5rem;
        inline-size: 2px;
        block-size: calc(100% + 0.5rem);
        background-color: var(--brand-border);
      }
      .dot {
        inline-size: 0.75rem;
        block-size: 0.75rem;
        margin-block-start: 0.25rem;
        border-radius: var(--brand-radius-full);
        background-color: var(--brand-primary);
        border: 2px solid var(--brand-surface);
        box-shadow: 0 0 0 1px var(--brand-border);
      }
      .content {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .at {
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      .note {
        margin: 0;
        color: var(--brand-text);
        font-size: var(--brand-text-body);
      }
    `,
  ],
})
export class OrderStatusTimelineComponent {
  readonly events = input.required<OrderTimelineEvent[]>();

  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;

  protected formatTime(value: string): string {
    const tag = LOCALE_INTL_TAG[this.locale.locale()];
    try {
      return new Intl.DateTimeFormat(tag, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch {
      return value;
    }
  }
}
