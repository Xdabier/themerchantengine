import { Test } from '@nestjs/testing';
import { NEUTRAL_MONEY, storeMoney } from '@common/money';
import { loadStoreConfigFixture } from '@common/store-config-fixtures';
import { SettingsService } from '../settings/settings.service';
import { CurrenciesService } from './currencies.service';
import { MoneyFormatterService } from './money-formatter.service';

const NNBSP = String.fromCodePoint(0x202f);
const NBSP = String.fromCodePoint(0x00a0);

describe('MoneyFormatterService', () => {
  const settings = { getGroup: jest.fn() };
  const currencies = { getStore: jest.fn() };
  let service: MoneyFormatterService;

  function arrange(fixtureId: 'gulf-rtl' | 'maghreb-ltr' | 'demo'): void {
    const money = loadStoreConfigFixture(fixtureId).money;
    currencies.getStore.mockResolvedValue({
      code: money.currencyCode,
      symbol: money.symbol,
      decimalPlaces: money.displayPrecision,
      enabled: [money.currencyCode],
    });
    settings.getGroup.mockResolvedValue({
      symbolPosition: money.symbolPosition,
      decimalSeparator: money.decimalSeparator,
      thousandsSeparator: money.thousandsSeparator,
      taxDisplay: money.taxDisplay,
      vatRate: money.vatRate,
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    storeMoney.set(NEUTRAL_MONEY);
    const module = await Test.createTestingModule({
      providers: [
        MoneyFormatterService,
        { provide: SettingsService, useValue: settings },
        { provide: CurrenciesService, useValue: currencies },
      ],
    }).compile();
    service = module.get(MoneyFormatterService);
  });

  afterAll(() => storeMoney.set(NEUTRAL_MONEY));

  it('formats the maghreb store: three decimals, symbol after, HT', async () => {
    arrange('maghreb-ltr');
    await service.onModuleInit();
    expect(service.format(1240)).toBe(`1${NNBSP}240,000${NBSP}LD`);
    expect(service.format(0)).toBe(`0,000${NBSP}LD`);
    expect(service.taxLabel()).toBe('HT');
    expect(service.currencyCode()).toBe('LYD');
    expect(service.config().vatRate).toBe(0.19);
  });

  it('formats the gulf store: two decimals, symbol before, no tax mention', async () => {
    arrange('gulf-rtl');
    await service.onModuleInit();
    expect(service.format(1240)).toBe(`د.إ${NBSP}1,240.00`);
    expect(service.taxLabel()).toBe('');
    expect(service.currencyCode()).toBe('AED');
  });

  it('formats a row in another currency with that currency symbol and precision', async () => {
    arrange('maghreb-ltr');
    await service.onModuleInit();
    expect(service.format(10, 'AED')).toBe(`10,00${NBSP}د.إ`);
  });

  it('refreshes on store-config.updated', async () => {
    arrange('gulf-rtl');
    await service.onModuleInit();
    arrange('demo');
    await service.onStoreConfigUpdated();
    expect(service.format(19.9)).toBe(`19,90${NBSP}€`);
    expect(service.taxLabel()).toBe('TTC');
  });

  it('keeps the last good snapshot when the database is unavailable', async () => {
    arrange('maghreb-ltr');
    await service.refresh();
    currencies.getStore.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.refresh()).resolves.toMatchObject({ currencyCode: 'LYD' });
  });
});
