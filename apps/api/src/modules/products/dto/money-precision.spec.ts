import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateProductVariantAdminDto } from './create-variant.dto';
import { BulkPriceItemDto } from './bulk-prices.dto';
import { AdjustGiftCardBalanceDto } from '../../gift-cards/dto/adjust-balance.dto';
import {
  CreateShippingMethodAdminDto,
  PriceRangeDto,
  WeightRangeDto,
} from '../../shipping/dto/create-method.dto';

/**
 * The server-side money gates, which had no test in EITHER direction.
 *
 * Three of these carried `@IsNumber({ maxDecimalPlaces: 2 })` and so returned
 * 400 on a legitimate millime price — the operator-facing failure of a
 * three-decimal currency. The other two, the shipping ranges, carried
 * `@IsOptional()` and nothing else: no array check, no element validator, no
 * scale, so an arbitrary value landed in a Json column and came back out as a
 * live shipping charge.
 *
 * Both halves are asserted here, because "accepts three" without "rejects
 * four" is a gate that has been removed rather than moved.
 */

/**
 * Every failing property as a dotted path, so a nested element error reads
 * `weightRanges.0.price` rather than the bare array index `0`. A helper that
 * flattens to the index cannot tell which property failed, which would make
 * these assertions match almost anything.
 */
function errorsFor<T extends object>(cls: new () => T, payload: Record<string, unknown>): string[] {
  const walk = (errs: ReturnType<typeof validateSync>, prefix = ''): string[] =>
    errs.flatMap((e) => {
      const path = prefix ? `${prefix}.${e.property}` : e.property;
      const own = Object.keys(e.constraints ?? {}).length ? [path] : [];
      return [...own, ...walk(e.children ?? [], path)];
    });
  return walk(validateSync(plainToInstance(cls, payload), { whitelist: true }));
}

describe('money precision at the API boundary', () => {
  describe('CreateProductVariantAdminDto', () => {
    const base = { sku: 'WDG-1', price: 1 };

    it.each(['price', 'compareAtPrice', 'costPrice'])('accepts a millime %s', (field) => {
      expect(errorsFor(CreateProductVariantAdminDto, { ...base, [field]: 12.345 })).not.toContain(
        field,
      );
    });

    it.each(['price', 'compareAtPrice', 'costPrice'])('rejects a fourth decimal on %s', (field) => {
      expect(errorsFor(CreateProductVariantAdminDto, { ...base, [field]: 12.3456 })).toContain(
        field,
      );
    });
  });

  describe('BulkPriceItemDto', () => {
    it('accepts a millime price and rejects a fourth decimal', () => {
      const id = '04f5c9a4-1a1a-4a4a-8a8a-000000000000';
      expect(errorsFor(BulkPriceItemDto, { variantId: id, price: 9.999 })).not.toContain('price');
      expect(errorsFor(BulkPriceItemDto, { variantId: id, price: 9.9999 })).toContain('price');
    });
  });

  describe('AdjustGiftCardBalanceDto', () => {
    it('accepts a millime adjustment and rejects a fourth decimal', () => {
      expect(errorsFor(AdjustGiftCardBalanceDto, { amount: 25.75 })).not.toContain('amount');
      expect(errorsFor(AdjustGiftCardBalanceDto, { amount: 25.755 })).not.toContain('amount');
      expect(errorsFor(AdjustGiftCardBalanceDto, { amount: 25.7555 })).toContain('amount');
    });
  });

  describe('shipping range elements', () => {
    it('validates a weight band element-wise', () => {
      expect(errorsFor(WeightRangeDto, { minKg: 0, maxKg: 5, price: 8.5 })).toEqual([]);
      expect(errorsFor(WeightRangeDto, { minKg: 0, maxKg: 5, price: -1 })).toContain('price');
      expect(errorsFor(WeightRangeDto, { minKg: 0, maxKg: 5, price: 8.5555 })).toContain('price');
    });

    it('validates a price band element-wise', () => {
      expect(errorsFor(PriceRangeDto, { minAmount: 0, maxAmount: 100, price: 5 })).toEqual([]);
      expect(errorsFor(PriceRangeDto, { minAmount: 0, maxAmount: 100, price: -5 })).toContain(
        'price',
      );
    });

    it('rejects a malformed element nested inside the method DTO', () => {
      // The hole this closes: the property was declared and its CONTENTS were
      // checked by nothing, so a string price persisted to the Json column.
      const bad = {
        zoneId: 'z1',
        name: { default: 'Standard' },
        type: 'FLAT_RATE',
        weightRanges: [{ minKg: 0, maxKg: 5, price: 'free' }],
      };
      expect(errorsFor(CreateShippingMethodAdminDto, bad)).toContain('weightRanges.0.price');
    });

    it('accepts a well-formed element nested inside the method DTO', () => {
      const good = {
        zoneId: 'z1',
        name: { default: 'Standard' },
        type: 'FLAT_RATE',
        weightRanges: [{ minKg: 0, maxKg: 5, price: 8 }],
        priceRanges: [{ minAmount: 0, maxAmount: 250, price: 5 }],
      };
      const errs = errorsFor(CreateShippingMethodAdminDto, good);
      expect(errs).toEqual([]);
    });
  });
});
