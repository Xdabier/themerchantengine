import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { OrderStatusBadgeComponent } from './order-status-badge.component';

describe('OrderStatusBadgeComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the localized PENDING label and pending tone', async () => {
    const fixture = await renderComponent(OrderStatusBadgeComponent, { status: 'PENDING' }, [
      LocaleService,
    ]);
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.getAttribute('data-tone')).toBe('pending');
    expect(badge.getAttribute('data-status')).toBe('PENDING');
    expect(badge.textContent?.trim()).toBe('En attente');
  });

  it('renders the SHIPPED label with shipped tone', async () => {
    const fixture = await renderComponent(OrderStatusBadgeComponent, { status: 'SHIPPED' }, [
      LocaleService,
    ]);
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.getAttribute('data-tone')).toBe('shipped');
    expect(badge.textContent?.trim()).toBe('Expédiée');
  });

  it('collapses COMPLETED into the delivered tone + label', async () => {
    const fixture = await renderComponent(OrderStatusBadgeComponent, { status: 'COMPLETED' }, [
      LocaleService,
    ]);
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.getAttribute('data-tone')).toBe('delivered');
    expect(badge.textContent?.trim()).toBe('Livrée');
  });

  it('exposes an aria-label combining the row status pattern + label', async () => {
    const fixture = await renderComponent(OrderStatusBadgeComponent, { status: 'CANCELLED' }, [
      LocaleService,
    ]);
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.getAttribute('aria-label')).toBe('Statut : Annulée');
  });

  it('axe — zero serious / critical violations', async () => {
    const fixture = await renderComponent(OrderStatusBadgeComponent, { status: 'PENDING' }, [
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });
});
