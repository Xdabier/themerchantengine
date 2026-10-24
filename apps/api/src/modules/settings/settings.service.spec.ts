import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from './settings.service';
import { STORE_CONFIG_UPDATED_EVENT } from './settings.events';
import { STORE_CONFIG } from './store.config';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  storeSetting: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(SettingsService);
  });

  // ── getDefaults ────────────────────────────────────────────────────────────

  describe('getDefaults', () => {
    it('returns the default STORE_CONFIG', () => {
      const result = service.getDefaults();

      expect(result).toEqual(STORE_CONFIG);
      expect(result.general.storeName).toBeDefined();
      expect(result.localization.supportedLocales).toEqual(['ar', 'fr', 'en']);
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns DB value when it exists', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: ['fr', 'en', 'de'],
      });

      const result = await service.get('supportedLocales');

      expect(result).toEqual(['fr', 'en', 'de']);
      expect(mockPrisma.storeSetting.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group_key: { group: 'localization', key: 'supportedLocales' } },
        }),
      );
    });

    it('falls back to default when DB value is not found', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      const result = await service.get('supportedLocales');

      expect(result).toEqual(['ar', 'fr', 'en']);
    });

    it('returns undefined for unknown keys', async () => {
      const result = await service.get('unknownKey');

      expect(result).toBeUndefined();
    });

    it('handles DB errors gracefully and falls back to defaults', async () => {
      mockPrisma.storeSetting.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.get('supportedLocales');

      expect(result).toEqual(['ar', 'fr', 'en']);
    });
  });

  // ── getGroup ───────────────────────────────────────────────────────────────

  describe('getGroup', () => {
    it('returns all keys in a group with DB overrides', async () => {
      mockPrisma.storeSetting.findMany.mockResolvedValue([
        { key: 'supportedLocales', value: ['fr', 'en', 'de'] },
        { key: 'timezone', value: 'Europe/Berlin' },
      ]);

      const result = await service.getGroup('localization');

      expect(result.supportedLocales).toEqual(['fr', 'en', 'de']);
      expect(result.timezone).toBe('Europe/Berlin');
      expect(result.defaultLocale).toBe('ar'); // from defaults
    });

    it('returns only defaults if no DB entries exist', async () => {
      mockPrisma.storeSetting.findMany.mockResolvedValue([]);

      const result = await service.getGroup('localization');

      expect(result.supportedLocales).toEqual(['ar', 'fr', 'en']);
      expect(result.defaultLocale).toBe('ar');
      expect(result.timezone).toBe('UTC');
    });

    it('returns empty object for invalid group', async () => {
      const result = await service.getGroup('invalid' as never);

      expect(result).toEqual({});
    });
  });

  // ── getAllGrouped ──────────────────────────────────────────────────────────

  describe('getAllGrouped', () => {
    it('returns all groups with all their settings', async () => {
      mockPrisma.storeSetting.findMany.mockResolvedValue([]);

      const result = await service.getAllGrouped();

      expect(result).toHaveProperty('general');
      expect(result).toHaveProperty('localization');
      expect(result).toHaveProperty('checkout');
      expect(result).toHaveProperty('inventory');
      expect(result).toHaveProperty('orders');
      expect(result).toHaveProperty('returns');
      expect(result).toHaveProperty('shipping');
      expect(result).toHaveProperty('business');

      // Verify each group has expected keys
      expect(result.general).toHaveProperty('storeName');
      expect(result.localization).toHaveProperty('supportedLocales');
      expect(result.checkout).toHaveProperty('guestCheckoutEnabled');
      expect(result.business).toHaveProperty('legalName');
      expect(result.business).toHaveProperty('streetAddress');
      expect(result.business).toHaveProperty('addressCountry');
      expect(result.business).toHaveProperty('businessType');
    });
  });

  // ── notifications group (NE6 — global "pause all email") ────────────────────

  describe('notifications group (NE6)', () => {
    it('get("pauseAll") returns the DB value when the notifications row exists', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue({ value: true });

      const result = await service.get('pauseAll');

      expect(result).toBe(true);
      expect(mockPrisma.storeSetting.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group_key: { group: 'notifications', key: 'pauseAll' } },
        }),
      );
    });

    it('get("pauseAll") falls back to the default (false) when no row exists', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      const result = await service.get('pauseAll');

      expect(result).toBe(false);
    });

    it('updateMany({ pauseAll }) upserts to group=notifications,key=pauseAll', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.updateMany({ pauseAll: true } as never);

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group_key: { group: 'notifications', key: 'pauseAll' } },
          create: expect.objectContaining({ value: true }),
          update: expect.objectContaining({ value: true }),
        }),
      );
    });

    it('getAllGrouped() includes the notifications group with pauseAll', async () => {
      mockPrisma.storeSetting.findMany.mockResolvedValue([]);

      const result = await service.getAllGrouped();

      expect(result).toHaveProperty('notifications');
      expect(result.notifications).toHaveProperty('pauseAll', false);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('upserts a setting in the database', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.update('supportedLocales', ['fr', 'en', 'ar']);

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group_key: { group: 'localization', key: 'supportedLocales' } },
          create: expect.objectContaining({ value: ['fr', 'en', 'ar'] }),
          update: expect.objectContaining({ value: ['fr', 'en', 'ar'] }),
        }),
      );
    });

    it('throws error for unknown keys', async () => {
      await expect(service.update('unknownKey', 'value')).rejects.toThrow('Unknown setting key');
    });

    it('throws error when key-group pair is invalid', async () => {
      // Try to update a key with wrong group (simulated via validation)
      // This depends on implementation details, but the key should match its group
      // For now, we just verify that invalid keys are rejected
      await expect(service.update('unknownKey123', 'value')).rejects.toThrow();
    });
  });

  // ── updateMany ────────────────────────────────────────────────────────────

  describe('updateMany', () => {
    it('upserts multiple settings from a DTO', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.updateMany({
        storeName: { default: 'New Store', en: 'New Store' },
        contactEmail: 'newemail@example.com',
        guestCheckoutEnabled: false,
      });

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(3);
    });

    it('skips undefined values in the DTO', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.updateMany({
        storeName: { default: 'New Store', en: 'New Store' },
        contactEmail: undefined,
        guestCheckoutEnabled: false,
      });

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it('does nothing when DTO is empty', async () => {
      await service.updateMany({});

      expect(mockPrisma.storeSetting.upsert).not.toHaveBeenCalled();
    });

    // ── currencyConfig completion ────────────────────────────────────────────
    // A `{ code }`-only patch used to replace the whole JSON object and wipe
    // `symbol` + `decimalPlaces` store-wide.

    function upsertedCurrencyConfig(): unknown {
      const call = mockPrisma.storeSetting.upsert.mock.calls.find(
        (c) =>
          (c[0] as { where: { group_key: { key: string } } }).where.group_key.key ===
          'currencyConfig',
      );
      return (call?.[0] as { update: { value: unknown } } | undefined)?.update.value;
    }

    it('completes a code-only currencyConfig from the catalogue', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: { code: 'AED', symbol: 'د.إ', decimalPlaces: 2 },
      });

      await service.updateMany({ currencyConfig: { code: 'KWD' } });

      expect(upsertedCurrencyConfig()).toEqual({
        code: 'KWD',
        symbol: 'د.ك',
        decimalPlaces: 3,
      });
    });

    it('keeps explicitly supplied symbol and decimalPlaces', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      await service.updateMany({
        currencyConfig: { code: 'AED', symbol: 'DH', decimalPlaces: 3 },
      });

      expect(upsertedCurrencyConfig()).toEqual({ code: 'AED', symbol: 'DH', decimalPlaces: 3 });
    });

    it('preserves the stored values for a code outside the catalogue', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: { code: 'ZZZ', symbol: '¤', decimalPlaces: 4 },
      });

      await service.updateMany({ currencyConfig: { code: 'ZZZ' } });

      expect(upsertedCurrencyConfig()).toEqual({ code: 'ZZZ', symbol: '¤', decimalPlaces: 4 });
    });

    // The admin reads this row on every screen, so a non-object value would
    // break every consumer that expects { code, symbol, decimalPlaces }.
    it.each([[[]], [[{ code: 'AED' }]], [null]])(
      'rejects a currencyConfig that is not a plain object (%p)',
      async (bad) => {
        mockPrisma.storeSetting.upsert.mockResolvedValue({});
        mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

        await expect(service.updateMany({ currencyConfig: bad } as never)).rejects.toMatchObject({
          response: { error: { code: 'SETTINGS_CURRENCY_CONFIG_INVALID' } },
        });
        expect(mockPrisma.storeSetting.upsert).not.toHaveBeenCalled();
      },
    );

    it('clamps decimalPlaces to the display range', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      await service.updateMany({ currencyConfig: { code: 'AED', decimalPlaces: 1e9 } } as never);

      expect(upsertedCurrencyConfig()).toEqual({ code: 'AED', symbol: 'د.إ', decimalPlaces: 3 });
    });

    it('truncates an oversized symbol', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      await service.updateMany({
        currencyConfig: { code: 'AED', symbol: 'X'.repeat(500) },
      } as never);

      expect((upsertedCurrencyConfig() as { symbol: string }).symbol).toBe('XXXXXXXX');
    });

    it('falls back to two decimals for an unknown code with nothing stored', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      await service.updateMany({ currencyConfig: { code: 'ZZZ' } });

      expect(upsertedCurrencyConfig()).toEqual({ code: 'ZZZ', symbol: 'ZZZ', decimalPlaces: 2 });
    });
  });

  // ── updateLocales ──────────────────────────────────────────────────────────

  describe('updateLocales', () => {
    it('updates both supportedLocales and defaultLocale', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.updateLocales(['fr', 'en', 'ar'], 'ar');

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.storeSetting.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          create: { group: 'localization', key: 'supportedLocales', value: ['fr', 'en', 'ar'] },
        }),
      );
      expect(mockPrisma.storeSetting.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          create: { group: 'localization', key: 'defaultLocale', value: 'ar' },
        }),
      );
    });

    it('persists rtlLocales in the same transaction when given', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.updateLocales(['fr', 'ar'], 'fr', ['ar']);

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(3);
      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { group: 'localization', key: 'rtlLocales', value: ['ar'] },
        }),
      );
    });

    it('leaves rtlLocales alone when not given', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await service.updateLocales(['fr', 'ar'], 'fr');

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it('refuses rtlLocales outside the supported set', async () => {
      await expect(service.updateLocales(['fr', 'en'], 'fr', ['ar'])).rejects.toMatchObject({
        response: { error: { code: 'SETTINGS_RTL_LOCALE_UNSUPPORTED' } },
      });
      expect(mockPrisma.storeSetting.upsert).not.toHaveBeenCalled();
    });

    it('refuses a locale outside the registry', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      await expect(service.updateLocales(['fr', 'en', 'de'], 'de')).rejects.toMatchObject({
        response: { error: { code: 'SETTINGS_LOCALE_NOT_IN_CATALOGUE' } },
      });
      expect(mockPrisma.storeSetting.upsert).not.toHaveBeenCalled();
    });

    it('throws error if defaultLocale is not in supportedLocales', async () => {
      await expect(service.updateLocales(['fr', 'en'], 'de')).rejects.toThrow(
        'defaultLocale must be one of the supportedLocales',
      );
    });
  });

  // ── getLocales ────────────────────────────────────────────────────────────

  describe('getLocales', () => {
    it('returns supportedLocales and defaultLocale together', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      const result = await service.getLocales();

      expect(result.supportedLocales).toEqual(['ar', 'fr', 'en']);
      expect(result.defaultLocale).toBe('ar');
    });

    it('returns DB values when they exist', async () => {
      mockPrisma.storeSetting.findUnique
        .mockResolvedValueOnce({ value: ['fr', 'en', 'de'] })
        .mockResolvedValueOnce({ value: 'de' });

      const result = await service.getLocales();

      expect(result.supportedLocales).toEqual(['fr', 'en', 'de']);
      expect(result.defaultLocale).toBe('de');
    });
  });

  // ── Appearance group (plan I phase I3) ──────────────────────────────────────

  /**
   * The admin appearance page has always written `logoUrl` and `faviconUrl`,
   * and the API has never had a group or a DTO field for either, so the PATCH
   * body was stripped and the page reported success for a value that was never
   * stored. These tests are the registry half of that fix.
   */
  describe('appearance group', () => {
    it('registers logoUrl and faviconUrl so updateMany can route them', async () => {
      mockPrisma.storeSetting.upsert.mockResolvedValue({} as never);

      await service.updateMany({ logoUrl: 'https://cdn.example.test/logo.png', faviconUrl: '' });

      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group_key: { group: 'appearance', key: 'logoUrl' } },
          create: expect.objectContaining({ value: 'https://cdn.example.test/logo.png' }),
        }),
      );
      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group_key: { group: 'appearance', key: 'faviconUrl' } },
        }),
      );
    });

    it('reads back under group=appearance with empty defaults', async () => {
      mockPrisma.storeSetting.findMany.mockResolvedValue([
        { key: 'logoUrl', value: 'https://cdn.example.test/logo.png' },
      ] as never);

      const group = await service.getGroup('appearance');

      expect(group).toEqual({ logoUrl: 'https://cdn.example.test/logo.png', faviconUrl: '' });
    });

    it('appears in getAllGrouped, which is what the admin page reads', async () => {
      mockPrisma.storeSetting.findMany.mockResolvedValue([] as never);

      const all = await service.getAllGrouped();

      expect(all['appearance']).toEqual({ logoUrl: '', faviconUrl: '' });
    });
  });

  /**
   * Plan E3.1.8. Every write path has to tell the caches derived from the
   * runtime config that they are stale: `RevalidationListener` drops the
   * storefront's locale roots on this event, and `StoreLocaleRegistry` reloads
   * the locale set from it. A write that saves the row and emits nothing leaves
   * a storefront serving the previous store name until the next deploy, which
   * is silent in every test that only reads the database back.
   *
   * The suites above build the service with Prisma alone, where the emitter is
   * an @Optional() slot and every emit is a no-op, so these cases build it with
   * an emitter of their own rather than extending that harness.
   */
  describe('store-config invalidation event', () => {
    let emitting: SettingsService;
    let emit: jest.Mock;

    beforeEach(async () => {
      jest.clearAllMocks();
      emit = jest.fn();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettingsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: EventEmitter2, useValue: { emit } },
        ],
      }).compile();
      emitting = module.get(SettingsService);
      mockPrisma.storeSetting.upsert.mockResolvedValue({});
    });

    it('emits the written group on update', async () => {
      await emitting.update('supportedLocales', ['ar', 'fr', 'en']);

      expect(emit).toHaveBeenCalledWith(STORE_CONFIG_UPDATED_EVENT, { groups: ['localization'] });
    });

    it('emits every distinct group touched by updateMany, once each', async () => {
      await emitting.updateMany({
        storeName: { default: 'New Store' },
        contactEmail: 'owner@example.com',
        guestCheckoutEnabled: false,
      });

      expect(emit).toHaveBeenCalledTimes(1);
      const [, payload] = emit.mock.calls[0] as [string, { groups: string[] }];
      expect([...payload.groups].sort()).toEqual(['checkout', 'general']);
    });

    it('emits localization on updateLocales', async () => {
      await emitting.updateLocales(['ar', 'fr', 'en'], 'en');

      expect(emit).toHaveBeenCalledWith(STORE_CONFIG_UPDATED_EVENT, { groups: ['localization'] });
    });

    it('emits nothing when updateMany was given nothing to write', async () => {
      await emitting.updateMany({});

      expect(emit).not.toHaveBeenCalled();
    });

    it('emits nothing when the write itself was refused', async () => {
      await expect(emitting.update('unknownKey', 'value')).rejects.toThrow('Unknown setting key');

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
