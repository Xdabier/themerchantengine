import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { CheckoutService } from './checkout.service';

function makePrismaMock() {
  return {
    storeSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

describe('CheckoutService', () => {
  let service: CheckoutService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let paymentMethods: { listStorefront: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    paymentMethods = { listStorefront: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentMethodsService, useValue: paymentMethods },
      ],
    }).compile();
    service = module.get(CheckoutService);
  });

  describe('getSettings', () => {
    it('returns defaults when no rows exist', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([]);
      const res = await service.getSettings();
      expect(res.guestCheckoutEnabled).toBe(true);
      expect(res.requiredFields).toEqual(['email']);
      expect(res.termsOfServiceUrl).toBeNull();
    });

    it('overlays persisted values atop defaults', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([
        { key: 'guestCheckoutEnabled', value: false },
        { key: 'requiredFields', value: ['email', 'phone'] },
        { key: 'termsOfServiceUrl', value: 'https://example.com/tos' },
      ]);
      const res = await service.getSettings();
      expect(res.guestCheckoutEnabled).toBe(false);
      expect(res.requiredFields).toEqual(['email', 'phone']);
      expect(res.termsOfServiceUrl).toBe('https://example.com/tos');
    });

    it('ignores rows with wrong shapes (bool slot holding a string)', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([
        { key: 'guestCheckoutEnabled', value: 'nope' },
        { key: 'requiredFields', value: 'not-an-array' },
      ]);
      const res = await service.getSettings();
      expect(res.guestCheckoutEnabled).toBe(true);
      expect(res.requiredFields).toEqual(['email']);
    });
  });

  describe('updateSettings', () => {
    it('upserts only the keys supplied', async () => {
      prisma.storeSetting.upsert.mockResolvedValue({});
      prisma.storeSetting.findMany.mockResolvedValue([]);
      await service.updateSettings({ guestCheckoutEnabled: false, requiredFields: ['email'] });
      expect(prisma.storeSetting.upsert).toHaveBeenCalledTimes(2);
      const keys = prisma.storeSetting.upsert.mock.calls.map(
        (c) => (c[0] as { create: { key: string } }).create.key,
      );
      expect(keys).toEqual(['guestCheckoutEnabled', 'requiredFields']);
    });

    it('no-op when the payload is empty', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([]);
      await service.updateSettings({});
      expect(prisma.storeSetting.upsert).not.toHaveBeenCalled();
    });
  });
  // ── getStorefrontSettings (plan F phase F1) ───────────────────────────────
  //
  // The public composite read. One fetch at checkout bootstrap has to answer
  // both "may a guest check out" and "which tenders are offered", so the two
  // halves travel together. The payment half is delegated to the owning
  // module's service (constitution §3.1); this service never touches
  // `prisma.paymentMethod`.
  describe('getStorefrontSettings', () => {
    it('returns the five checkout keys at their defaults on an empty settings table', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([]);
      const res = await service.getStorefrontSettings();
      expect(Object.keys(res.checkout).sort()).toEqual([
        'checkoutMessage',
        'guestCheckoutEnabled',
        'postPurchaseRedirectUrl',
        'requiredFields',
        'termsOfServiceUrl',
      ]);
      expect(res.checkout.guestCheckoutEnabled).toBe(true);
      expect(res.checkout.requiredFields).toEqual(['email']);
    });

    it('carries the persisted checkout values through unchanged', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([
        { key: 'guestCheckoutEnabled', value: false },
        { key: 'checkoutMessage', value: 'Paiement a la livraison uniquement' },
      ]);
      const res = await service.getStorefrontSettings();
      expect(res.checkout.guestCheckoutEnabled).toBe(false);
      expect(res.checkout.checkoutMessage).toBe('Paiement a la livraison uniquement');
    });

    it('delegates the payment half to PaymentMethodsService and never reads paymentMethod itself', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([]);
      paymentMethods.listStorefront.mockResolvedValue([
        {
          code: 'cod',
          name: { default: 'Cash on delivery' },
          description: null,
          provider: 'cod',
          sortOrder: 0,
        },
      ]);
      const res = await service.getStorefrontSettings();
      expect(paymentMethods.listStorefront).toHaveBeenCalledTimes(1);
      expect(res.paymentMethods).toHaveLength(1);
      expect(res.paymentMethods[0].code).toBe('cod');
      expect(prisma).not.toHaveProperty('paymentMethod');
    });

    it('returns an empty method list rather than failing when nothing is enabled', async () => {
      prisma.storeSetting.findMany.mockResolvedValue([]);
      paymentMethods.listStorefront.mockResolvedValue([]);
      const res = await service.getStorefrontSettings();
      expect(res.paymentMethods).toEqual([]);
    });
  });
});
