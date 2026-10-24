import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import {
  OrderStatusTimelineComponent,
  type OrderTimelineEvent,
} from './order-status-timeline.component';

const events: OrderTimelineEvent[] = [
  { status: 'PENDING', at: '2026-04-25T10:00:00Z' },
  { status: 'CONFIRMED', at: '2026-04-25T11:00:00Z' },
  { status: 'SHIPPED', at: '2026-04-26T08:30:00Z', note: 'Picked up by courier' },
];

describe('OrderStatusTimelineComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one timeline event per input', async () => {
    const fixture = await renderComponent(OrderStatusTimelineComponent, { events }, [
      LocaleService,
    ]);
    const items = fixture.nativeElement.querySelectorAll('.event');
    expect(items.length).toBe(3);
  });

  it('renders the status badge inside each event', async () => {
    const fixture = await renderComponent(OrderStatusTimelineComponent, { events }, [
      LocaleService,
    ]);
    const badges = fixture.nativeElement.querySelectorAll('app-order-status-badge');
    expect(badges.length).toBe(3);
  });

  it('renders the optional note when provided', async () => {
    const fixture = await renderComponent(OrderStatusTimelineComponent, { events }, [
      LocaleService,
    ]);
    const notes = fixture.nativeElement.querySelectorAll('.note');
    expect(notes.length).toBe(1);
    expect(notes[0].textContent).toContain('Picked up by courier');
  });

  it('emits a <time datetime> per event for screen readers + parseability', async () => {
    const fixture = await renderComponent(OrderStatusTimelineComponent, { events }, [
      LocaleService,
    ]);
    const times = fixture.nativeElement.querySelectorAll('time[datetime]');
    expect(times.length).toBe(3);
    expect(times[0].getAttribute('datetime')).toBe('2026-04-25T10:00:00Z');
  });

  it('renders a localized title heading', async () => {
    const fixture = await renderComponent(OrderStatusTimelineComponent, { events }, [
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('.title')?.textContent?.trim()).toBe(
      'Historique du statut',
    );
  });

  it('axe — zero serious / critical violations', async () => {
    const fixture = await renderComponent(OrderStatusTimelineComponent, { events }, [
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });
});
