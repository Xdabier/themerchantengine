import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { Order } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { LOCALE_INTL_TAG } from '../../../i18n/types';
import { APP_ROUTES } from '../../../lib/routes';
import { PriceComponent } from '../../ui/price.component';
import { OrderStatusBadgeComponent } from './order-status-badge.component';
import { StoreConfigService } from '../../services/store-config.service';

@Component({
  selector: 'app-order-row',
  standalone: true,
  imports: [OrderStatusBadgeComponent, PriceComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="row"
      [attr.data-testid]="'order-row-' + order().id"
      data-testid-shared="order-row"
    >
      <div class="primary">
        <h3 class="number">
          <a
            class="number-link"
            [routerLink]="detailHref()"
            [attr.data-testid]="'order-row-link-' + order().id"
          >
            {{ orderNumberLabel() }}
          </a>
        </h3>
        <p class="meta">
          <time class="placed-at" [attr.datetime]="order().createdAt">
            {{ placedAtLabel() }}
          </time>
        </p>
      </div>

      <div class="secondary">
        <app-order-status-badge [status]="order().status" />
        <app-price
          class="total"
          [amount]="totalNumber()"
          [currency]="currencyCode()"
          taxMention="included"
        />
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        padding-block: 0.875rem;
        padding-inline: 1rem;
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        background-color: var(--brand-surface);
        align-items: center;
        justify-content: space-between;
      }
      .primary {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .number {
        margin: 0;
        font-family: var(--brand-font-display); /* agent_docs/storefront/brand-tokens.md subtitle */
        font-size: var(--brand-text-product);
        font-weight: 500;
        color: var(--brand-text);
      }
      .number-link {
        color: var(--brand-text);
        text-decoration: none;
      }
      .number-link:hover {
        color: var(--brand-primary);
      }
      .number-link:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
        border-radius: var(--brand-radius-sm);
      }
      .meta {
        margin: 0;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      .secondary {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      /* agent_docs/storefront/brand-tokens.md — mandatory wherever numbers stack. */
      .total {
        font-variant-numeric: tabular-nums;
      }
      .total {
        font-weight: 600;
      }
    `,
  ],
})
export class OrderRowComponent {
  readonly order = input.required<Order>();

  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;

  protected readonly detailHref = computed(() =>
    APP_ROUTES.account.order(this.locale.locale(), this.order().id),
  );

  protected readonly orderNumberLabel = computed(() =>
    this.strings().account.orders.row.orderNumber.replace('{number}', this.order().orderNumber),
  );

  protected readonly placedAtLabel = computed(() =>
    this.strings().account.orders.row.placedAt.replace(
      '{date}',
      this.formatDate(this.order().createdAt),
    ),
  );

  protected readonly totalNumber = computed(() => Number(this.order().total));
  private readonly storeConfig = inject(StoreConfigService);

  protected readonly currencyCode = computed(
    () => this.order().currency ?? this.storeConfig.currencyCode(),
  );

  private formatDate(value: string): string {
    const tag = LOCALE_INTL_TAG[this.locale.locale()];
    try {
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(new Date(value));
    } catch {
      return value;
    }
  }
}
