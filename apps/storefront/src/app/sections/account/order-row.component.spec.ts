import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { Order } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { OrderRowComponent } from './order-row.component';

const baseOrder: Order = {
  id: '11111111-1111-1111-1111-111111111111',
  orderNumber: 'AKL-0001',
  status: 'PENDING',
  paymentStatus: 'PENDING',
  items: [],
  subtotal: '215.00',
  total: '215.00',
  currency: 'AED',
  createdAt: '2026-04-25T10:00:00Z',
} as Order;

describe('OrderRowComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the order number with the i18n template applied', async () => {
    const fixture = await renderComponent(OrderRowComponent, { order: baseOrder }, [
      provideRouter([]),
      LocaleService,
    ]);
    const link = fixture.nativeElement.querySelector('.number-link') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Commande AKL-0001');
  });

  it('routes the order number link to the order detail page in the active locale', async () => {
    const fixture = await renderComponent(OrderRowComponent, { order: baseOrder }, [
      provideRouter([]),
      LocaleService,
    ]);
    const link = fixture.nativeElement.querySelector('.number-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('/fr/account/orders/');
    expect(link.getAttribute('href')).toContain(baseOrder.id);
  });

  it('renders the status badge for the order status', async () => {
    const fixture = await renderComponent(OrderRowComponent, { order: baseOrder }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector(`[data-testid="order-status-badge-${baseOrder.status}"]`),
    ).not.toBeNull();
  });

  it('exposes a <time datetime> for the placed-at timestamp', async () => {
    const fixture = await renderComponent(OrderRowComponent, { order: baseOrder }, [
      provideRouter([]),
      LocaleService,
    ]);
    const time = fixture.nativeElement.querySelector('time.placed-at') as HTMLTimeElement;
    expect(time.getAttribute('datetime')).toBe(baseOrder.createdAt);
  });

  it('axe — zero serious / critical violations', async () => {
    const fixture = await renderComponent(OrderRowComponent, { order: baseOrder }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });
});
