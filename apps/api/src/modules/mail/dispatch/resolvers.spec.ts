import { resolveOrder } from './resolvers';
import type { DispatchContext } from './dispatch.types';

/**
 * Guest recipients for the order mails (plan F phase F3, finding K3).
 *
 * `resolveOrder` returned null for any order without a user email, and a null
 * resolution means the dispatcher sends nothing. That is correct for an order
 * with no contact address at all, and silently wrong for a guest order, whose
 * address lives in `guestEmail`. Without this the first thing guest checkout
 * would have shipped is a customer who pays and never hears back.
 */
function makeCtx(order: unknown): DispatchContext {
  return {
    prisma: {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
    },
    config: { get: jest.fn().mockReturnValue('https://storefront.example.test') },
  } as unknown as DispatchContext;
}

const BASE = {
  id: 'order-1',
  orderNumber: 'ORD-2026-000001',
  total: '120.000',
  currency: 'LYD',
  items: [{ id: 'i1' }],
  shipments: [],
};

describe('resolveOrder', () => {
  it('resolves an account order from the user row, as it always has', async () => {
    const ctx = makeCtx({
      ...BASE,
      user: { email: 'customer@example.test', firstName: 'Amel', locale: 'fr' },
      guestEmail: null,
      guestLocale: null,
    });
    const res = await resolveOrder({ orderId: 'order-1' } as never, ctx);
    expect(res?.to).toBe('customer@example.test');
    expect(res?.locale).toBe('fr');
    expect(res?.variables.customerName).toBe('Amel');
  });

  it('resolves a guest order from its contact address', async () => {
    const ctx = makeCtx({
      ...BASE,
      user: null,
      guestEmail: 'guest@example.test',
      guestLocale: 'fr',
    });
    const res = await resolveOrder({ orderId: 'order-1' } as never, ctx);
    expect(res?.to).toBe('guest@example.test');
  });

  it('sends a guest their mail in the locale they checked out in', async () => {
    // There is no user row to read a locale from. Without the captured one
    // every guest email goes out in the default locale, which on this store
    // means a French customer receiving English.
    const ctx = makeCtx({
      ...BASE,
      user: null,
      guestEmail: 'guest@example.test',
      guestLocale: 'en',
    });
    const res = await resolveOrder({ orderId: 'order-1' } as never, ctx);
    expect(res?.locale).toBe('en');
  });

  it('prefers the account address when an order somehow carries both', async () => {
    const ctx = makeCtx({
      ...BASE,
      user: { email: 'customer@example.test', firstName: 'Amel', locale: 'fr' },
      guestEmail: 'guest@example.test',
      guestLocale: 'en',
    });
    const res = await resolveOrder({ orderId: 'order-1' } as never, ctx);
    expect(res?.to).toBe('customer@example.test');
    expect(res?.locale).toBe('fr');
  });

  it('still resolves null when there is no address of either kind', async () => {
    const ctx = makeCtx({ ...BASE, user: null, guestEmail: null, guestLocale: null });
    await expect(resolveOrder({ orderId: 'order-1' } as never, ctx)).resolves.toBeNull();
  });

  it('resolves null for an order that does not exist', async () => {
    const ctx = makeCtx(null);
    await expect(resolveOrder({ orderId: 'nope' } as never, ctx)).resolves.toBeNull();
  });

  it('omits the customer name for a guest rather than inventing one', async () => {
    const ctx = makeCtx({
      ...BASE,
      user: null,
      guestEmail: 'guest@example.test',
      guestLocale: 'fr',
    });
    const res = await resolveOrder({ orderId: 'order-1' } as never, ctx);
    expect(res?.variables.customerName).toBeUndefined();
  });

  it('selects the guest columns, or the query cannot answer any of this', async () => {
    const ctx = makeCtx({ ...BASE, user: null, guestEmail: 'g@d.test', guestLocale: 'fr' });
    await resolveOrder({ orderId: 'order-1' } as never, ctx);
    const select = (ctx.prisma.order.findUnique as unknown as jest.Mock).mock.calls[0][0].select;
    expect(select.guestEmail).toBe(true);
    expect(select.guestLocale).toBe(true);
  });
});
