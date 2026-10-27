import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { ConfigService } from '@nestjs/config';
import { BackInStockListener } from './back-in-stock.listener';

// ── Mocks ───────────────────────────────────────────────────────────────────

function makeMocks() {
  const mail = {
    enqueue: jest.fn().mockResolvedValue({ logId: 'log-1', jobId: 'job-1', suppressed: false }),
    recordEnqueueFailure: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    product: { findUnique: jest.fn() },
    wishlistItem: { findMany: jest.fn() },
  };
  const config = {
    get: jest.fn().mockReturnValue('https://storefront.example.test'),
  } as unknown as ConfigService;
  const listener = new BackInStockListener(mail as never, prisma as never, config);
  return { mail, prisma, config, listener };
}

const PRODUCT = {
  name: { fr: 'Fraise diamantée', en: 'Diamond bur' },
  slug: 'fraise-diamantee',
  deletedAt: null,
};

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('BackInStockListener (NE8)', () => {
  it('fans out one back-in-stock email per active wishlister', async () => {
    const { mail, prisma, listener } = makeMocks();
    prisma.product.findUnique.mockResolvedValue(PRODUCT);
    prisma.wishlistItem.findMany.mockResolvedValue([
      { userId: 'u-1', user: { email: 'a@x.com', locale: 'en' } },
      { userId: 'u-2', user: { email: 'b@x.com', locale: 'fr' } },
    ]);

    await listener.onRestocked({
      variantId: 'var-1',
      productId: 'prod-1',
      sku: 'SKU',
      quantity: 5,
    });

    expect(mail.enqueue).toHaveBeenCalledTimes(2);
    expect(mail.enqueue).toHaveBeenCalledWith(
      'product.back-in-stock',
      expect.objectContaining({
        to: 'a@x.com',
        locale: 'en',
        variables: {
          productName: 'Diamond bur',
          productUrl: expect.stringContaining('fraise-diamantee'),
        },
        dedupeKey: expect.stringMatching(/^backinstock:u-1:prod-1:\d{4}-\d{2}-\d{2}$/),
      }),
    );
    // The French recipient gets the French product name.
    expect(mail.enqueue).toHaveBeenCalledWith(
      'product.back-in-stock',
      expect.objectContaining({
        to: 'b@x.com',
        locale: 'fr',
        variables: expect.objectContaining({ productName: 'Fraise diamantée' }),
      }),
    );
  });

  it('writes to a wishlister with a stale locale in French', async () => {
    // Rows carried over from the previous client still hold `ar`; the resolver
    // normalises anything unrecognised to the store default.
    const { mail, prisma, listener } = makeMocks();
    prisma.product.findUnique.mockResolvedValue(PRODUCT);
    prisma.wishlistItem.findMany.mockResolvedValue([
      { userId: 'u-3', user: { email: 'c@x.com', locale: 'ar' } },
    ]);

    await listener.onRestocked({ variantId: 'var-1', productId: 'prod-1' });

    expect(mail.enqueue).toHaveBeenCalledWith(
      'product.back-in-stock',
      expect.objectContaining({
        locale: 'fr',
        variables: expect.objectContaining({ productName: 'Fraise diamantée' }),
      }),
    );
  });

  it('does nothing when the payload carries no productId', async () => {
    const { mail, prisma, listener } = makeMocks();
    await listener.onRestocked({ variantId: 'var-1', productId: null });
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('skips a soft-deleted / missing product', async () => {
    const { mail, prisma, listener } = makeMocks();
    prisma.product.findUnique.mockResolvedValue({ ...PRODUCT, deletedAt: new Date() });
    await listener.onRestocked({ variantId: 'var-1', productId: 'prod-1' });
    expect(prisma.wishlistItem.findMany).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('no-ops when nobody has wishlisted the product', async () => {
    const { mail, prisma, listener } = makeMocks();
    prisma.product.findUnique.mockResolvedValue(PRODUCT);
    prisma.wishlistItem.findMany.mockResolvedValue([]);
    await listener.onRestocked({ variantId: 'var-1', productId: 'prod-1' });
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('tolerates a consent-gated skip without throwing (enqueue returns skipped)', async () => {
    const { mail, prisma, listener } = makeMocks();
    mail.enqueue.mockResolvedValue({
      logId: 'log-1',
      jobId: undefined,
      suppressed: false,
      skipped: true,
    });
    prisma.product.findUnique.mockResolvedValue(PRODUCT);
    prisma.wishlistItem.findMany.mockResolvedValue([
      { userId: 'u-1', user: { email: 'a@x.com', locale: 'en' } },
    ]);
    await expect(
      listener.onRestocked({ variantId: 'var-1', productId: 'prod-1' }),
    ).resolves.toBeUndefined();
    expect(mail.enqueue).toHaveBeenCalledTimes(1);
  });

  it('records an enqueue-failed audit row and never rethrows on a query failure', async () => {
    const { mail, prisma, listener } = makeMocks();
    prisma.product.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      listener.onRestocked({ variantId: 'var-1', productId: 'prod-1' }),
    ).resolves.toBeUndefined();
    expect(mail.recordEnqueueFailure).toHaveBeenCalledWith(
      'product.back-in-stock',
      '(unresolved)',
      'db down',
      expect.objectContaining({ event: 'inventory.restocked', productId: 'prod-1' }),
    );
  });
});
