import {
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
} from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { isCurrencyCode, type Step } from './types';

/**
 * Money and tax (plan E4.3): the currency and how it renders, the VAT rate,
 * whether prices show tax, and the domestic flat shipping rate that replaces
 * the seed's placeholder. Display precision defaults from the currency's
 * minor unit as Intl knows it.
 */
export function intlPrecision(currencyCode: string): number {
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits;
    return Math.min(3, Math.max(0, digits ?? 2));
  } catch {
    return 2;
  }
}

export const moneyStep: Step = {
  id: 'money',
  title: 'Currency, tax and shipping',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const money = ctx.answers.money ?? {};
    const currencyCode = await ctx.prompter.text({
      path: 'money.currencyCode',
      label: 'Currency (ISO 4217, EUR)',
      initial: money.currencyCode,
      validate: (v) => (isCurrencyCode(v) ? null : 'three upper-case letters'),
    });
    const symbol = await ctx.prompter.text({
      path: 'money.symbol',
      label: 'Currency symbol as shown on prices',
      initial: money.symbol ?? currencyCode,
      validate: (v) => (v.length > 0 ? null : 'a symbol or the code'),
    });
    const symbolPosition = await ctx.prompter.select({
      path: 'money.symbolPosition',
      label: 'Symbol position',
      initial: money.symbolPosition ?? 'after',
      choices: STORE_CONFIG_SYMBOL_POSITIONS.map((value) => ({
        value,
        label:
          value === 'before'
            ? `before the amount (${symbol}12.50)`
            : `after the amount (12.50 ${symbol})`,
      })),
    });
    const decimalSeparator = await ctx.prompter.text({
      path: 'money.decimalSeparator',
      label: 'Decimal separator',
      initial: money.decimalSeparator ?? ',',
      validate: (v) => (v.length === 1 ? null : 'one character'),
    });
    const thousandsSeparator = await ctx.prompter.text({
      path: 'money.thousandsSeparator',
      label: 'Thousands separator',
      initial: money.thousandsSeparator ?? ' ',
      validate: (v) =>
        v.length !== 1
          ? 'one character'
          : v === decimalSeparator
            ? 'must differ from the decimal separator'
            : null,
    });
    const displayPrecision = await ctx.prompter.number({
      path: 'money.displayPrecision',
      label: 'Decimals shown on prices',
      initial: money.displayPrecision ?? intlPrecision(currencyCode),
      validate: (v) => (Number.isInteger(v) && v >= 0 && v <= 3 ? null : '0 to 3'),
    });
    const vatPercent = await ctx.prompter.number({
      path: 'money.vatPercent',
      label: 'VAT rate in percent (20 for twenty percent, 0 for none)',
      initial:
        money.vatPercent ??
        (money.vatRate !== undefined ? Math.round(money.vatRate * 10000) / 100 : 0),
      validate: (v) => (v >= 0 && v <= 100 ? null : '0 to 100'),
    });
    const taxDisplay = await ctx.prompter.select({
      path: 'money.taxDisplay',
      label: 'How prices show tax',
      initial: money.taxDisplay ?? (vatPercent > 0 ? 'TTC' : 'none'),
      choices: STORE_CONFIG_TAX_DISPLAYS.map((value) => ({
        value,
        label:
          value === 'TTC'
            ? 'TTC: prices include tax and say so'
            : value === 'HT'
              ? 'HT: prices exclude tax and say so'
              : 'none: no tax mention on prices',
      })),
    });
    const shippingFlatRate = await ctx.prompter.number({
      path: 'money.shippingFlatRate',
      label: `Domestic flat shipping rate (${currencyCode})`,
      initial: money.shippingFlatRate ?? 10,
      validate: (v) => (v >= 0 ? null : 'zero or more'),
    });
    ctx.answers.money = {
      currencyCode,
      symbol,
      symbolPosition,
      decimalSeparator,
      thousandsSeparator,
      displayPrecision,
      taxDisplay,
      vatRate: Math.round(vatPercent * 100) / 10000,
      vatPercent,
      shippingFlatRate,
    };
  },
};
