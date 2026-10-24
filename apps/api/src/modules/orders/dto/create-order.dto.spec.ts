// `@Type` on the nested address DTO reads design-time metadata, which the
// unit-test runtime does not install on its own.
import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateOrderDto } from './create-order.dto';

/**
 * The gift-card code range on order creation.
 *
 * Codes are issued 8 to 20 uppercase alphanumerics: `CreateGiftCardDto` says
 * so, and `ApplyGiftCardDto` on the cart route agrees. Order creation demanded
 * exactly 16, which is the length the generator happens to produce but not the
 * range an operator can issue, so a short operator-issued card applied on the
 * cart and then 400'd at checkout.
 */
const ADDRESS = {
  fullName: 'E2E Tester',
  phone: '+218912345678',
  addressLine1: '12 Sample Street',
  city: 'Tripoli',
  country: 'LY',
};

async function validateGiftCardCode(giftCardCode: string) {
  const dto = plainToInstance(CreateOrderDto, { shippingAddress: ADDRESS, giftCardCode });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'giftCardCode');
}

describe('CreateOrderDto giftCardCode', () => {
  it.each(['ABCD1234', 'FXGIFTWELCOME100', 'A1B2C3D4E5F6G7H8I9J0'])(
    'accepts an operator-issuable code: %s',
    async (code) => {
      expect(await validateGiftCardCode(code)).toHaveLength(0);
    },
  );

  it.each([
    ['seven characters, one below the floor', 'ABCD123'],
    ['twenty-one characters, one above the ceiling', 'A1B2C3D4E5F6G7H8I9J0K'],
    ['lowercase', 'abcd1234efgh'],
    ['dashes, which the seeded GIFT-TEST-1234 uses', 'GIFT-TEST-1234'],
  ])('rejects %s', async (_label, code) => {
    expect(await validateGiftCardCode(code)).toHaveLength(1);
  });
});
