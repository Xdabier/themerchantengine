import { NOTIFICATION_TEMPLATES, NotificationType } from './notifications.constants';

const SHIPPED_LOCALES = ['ar', 'fr', 'en'] as const;

const SAMPLE_DATA: Record<NotificationType, unknown> = {
  [NotificationType.NEW_ORDER]: { orderNumber: 'ORD-1' },
  [NotificationType.LOW_STOCK]: { sku: 'SKU-1', quantity: 2 },
  [NotificationType.OUT_OF_STOCK]: { sku: 'SKU-1' },
  [NotificationType.NEW_REVIEW]: { productName: 'Lamp', rating: 4 },
  [NotificationType.RETURN_REQUESTED]: { orderId: 'o1', reason: 'Broken' },
};

describe('NOTIFICATION_TEMPLATES', () => {
  const types = Object.values(NotificationType);

  it.each(types)('%s title carries copy for every shipped locale', (type) => {
    const { title } = NOTIFICATION_TEMPLATES[type];
    for (const locale of SHIPPED_LOCALES) expect(title[locale]).toBeTruthy();
    expect(title.default).toBeTruthy();
  });

  it.each(types)('%s body carries copy for every shipped locale', (type) => {
    const body = NOTIFICATION_TEMPLATES[type].bodyTemplate?.(SAMPLE_DATA[type]);
    expect(body).toBeDefined();
    for (const locale of SHIPPED_LOCALES) expect(body?.[locale]).toBeTruthy();
    expect(body?.default).toBeTruthy();
  });

  it.each(types)('%s body without data stays in each locale', (type) => {
    const body = NOTIFICATION_TEMPLATES[type].bodyTemplate?.(undefined);
    for (const locale of SHIPPED_LOCALES) expect(body?.[locale]).toBeTruthy();
  });

  it('keeps the product name in every locale of a review body', () => {
    const body = NOTIFICATION_TEMPLATES[NotificationType.NEW_REVIEW].bodyTemplate?.({
      productName: 'Lamp',
      rating: 4,
    });
    for (const locale of SHIPPED_LOCALES) expect(body?.[locale]).toContain('Lamp');
  });

  it('writes the missing-product fallback in the locale of the line', () => {
    const body = NOTIFICATION_TEMPLATES[NotificationType.NEW_REVIEW].bodyTemplate?.({ rating: 3 });
    expect(body?.fr).toContain('Un produit');
    expect(body?.en).toContain('A product');
    expect(body?.ar).not.toMatch(/[A-Za-z]/);
  });
});
