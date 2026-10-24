import { IsEmail, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AddressDto {
  @IsString()
  fullName!: string;

  @IsString()
  phone!: string;

  @IsString()
  addressLine1!: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country!: string;
}

export class CreateOrderDto {
  /**
   * Contact address for a guest order. Optional here because an account order
   * must never carry it: the customer's own address is the one that counts, and
   * accepting this field from a signed-in caller would let them redirect their
   * own confirmation mail. The guest branch of `createOrder` enforces that it
   * is present, and the authed branch ignores it entirely.
   */
  @IsOptional()
  @IsEmail()
  guestEmail?: string;

  @IsOptional()
  @IsString()
  shippingAddressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;

  @IsOptional()
  @IsString()
  billingAddressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress?: AddressDto;

  @IsOptional()
  @IsString()
  shippingMethodId?: string;

  /**
   * The tender the customer picked, validated at create time against the
   * operator's enabled set rather than trusted. Optional so an old client and
   * a replayed payload still place an order on a store with exactly one
   * enabled method; a store with several requires the choice.
   */
  @IsOptional()
  @IsString()
  paymentMethodCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Eight to twenty uppercase alphanumerics, the range `CreateGiftCardDto`
   * issues and `ApplyGiftCardDto` already accepts on the cart route. This
   * required exactly sixteen, so a card an operator issued at any other length
   * could be applied to a cart and then rejected at checkout.
   */
  @IsOptional()
  @Matches(/^[A-Z0-9]{8,20}$/)
  giftCardCode?: string;

  @IsOptional()
  @IsString()
  couponCode?: string;
}
