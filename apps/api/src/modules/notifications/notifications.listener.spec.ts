import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { EVENT_NOTIFICATION_MAP, NOTIFICATION_TEMPLATES } from './notifications.constants';

const EVENT_LISTENER_METADATA = 'EVENT_LISTENER_METADATA';

function collectSubscribedEvents(listener: object): string[] {
  const events: string[] = [];
  const proto = Object.getPrototypeOf(listener);
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const method = (proto as Record<string, unknown>)[key];
    if (typeof method !== 'function') continue;
    const meta = Reflect.getMetadata(EVENT_LISTENER_METADATA, method);
    const entries = Array.isArray(meta) ? meta : meta ? [meta] : [];
    for (const entry of entries) {
      if (entry && typeof entry === 'object' && 'event' in entry) {
        const e = (entry as { event: string | string[] }).event;
        if (Array.isArray(e)) events.push(...e);
        else events.push(e);
      }
    }
  }
  return events;
}

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let service: { createForAllAdmins: jest.Mock };

  beforeEach(async () => {
    service = { createForAllAdmins: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsListener, { provide: NotificationsService, useValue: service }],
    }).compile();

    listener = module.get(NotificationsListener);
  });

  it('subscribes to every event name in EVENT_NOTIFICATION_MAP', () => {
    const subscribed = collectSubscribedEvents(listener);
    for (const evt of Object.keys(EVENT_NOTIFICATION_MAP)) {
      expect(subscribed).toContain(evt);
    }
  });

  it('does not subscribe to any dormant legacy event name', () => {
    const subscribed = collectSubscribedEvents(listener);
    expect(subscribed).not.toContain('review.submitted');
    expect(subscribed).not.toContain('return.requested');
  });

  it('every NotificationType has a matching template', () => {
    for (const type of Object.values(EVENT_NOTIFICATION_MAP)) {
      expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
      expect(NOTIFICATION_TEMPLATES[type].title.default).toBeTruthy();
    }
  });

  // In-app admin copy is user-facing text, so it carries the store's locale
  // pair, not a single English string echoed into both slots.
  it('every template carries distinct fr + en copy', () => {
    for (const type of Object.values(EVENT_NOTIFICATION_MAP)) {
      const template = NOTIFICATION_TEMPLATES[type];
      expect(template.title.fr).toBeTruthy();
      expect(template.title.en).toBeTruthy();
      expect(template.title.fr).not.toBe(template.title.en);

      const body = template.bodyTemplate?.({});
      expect(body?.fr).toBeTruthy();
      expect(body?.en).toBeTruthy();
      expect(body?.fr).not.toBe(body?.en);
    }
  });

  it('order.created handler fans out a NEW_ORDER notification', async () => {
    await listener.onOrderCreated({ id: 'ord-1', orderNumber: 'R-1' });
    expect(service.createForAllAdmins).toHaveBeenCalledWith(
      'NEW_ORDER',
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('review.created handler fans out a NEW_REVIEW notification', async () => {
    await listener.onReviewCreated({ productId: 'p-1', userId: 'u-1' });
    expect(service.createForAllAdmins).toHaveBeenCalledWith(
      'NEW_REVIEW',
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('return.created handler fans out a RETURN_REQUESTED notification', async () => {
    await listener.onReturnCreated({ orderId: 'o-1', reason: 'damaged' });
    expect(service.createForAllAdmins).toHaveBeenCalledWith(
      'RETURN_REQUESTED',
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('inventory.low_stock handler fans out a LOW_STOCK notification', async () => {
    await listener.onInventoryLowStock({ variantId: 'v-1', sku: 'SKU-1', quantity: 5 });
    expect(service.createForAllAdmins).toHaveBeenCalledWith(
      'LOW_STOCK',
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('inventory.out_of_stock handler fans out an OUT_OF_STOCK notification', async () => {
    await listener.onInventoryOutOfStock({ variantId: 'v-1', sku: 'SKU-1' });
    expect(service.createForAllAdmins).toHaveBeenCalledWith(
      'OUT_OF_STOCK',
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('swallows errors thrown by the service so upstream emit keeps flowing', async () => {
    service.createForAllAdmins.mockRejectedValueOnce(new Error('DB down'));
    await expect(listener.onOrderCreated({ id: 'ord-2' })).resolves.toBeUndefined();
  });
});
