import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Keys operators can require collected from guests at checkout. Kept
 * strict so the admin UI can render it as a fixed checkbox set.
 */
export const CHECKOUT_REQUIRED_FIELDS = [
  'email',
  'phone',
  'shippingAddress',
  'billingAddress',
  'company',
  'note',
] as const;

export type CheckoutRequiredField = (typeof CHECKOUT_REQUIRED_FIELDS)[number];

export class UpdateCheckoutSettingsDto {
  @IsBoolean()
  @IsOptional()
  guestCheckoutEnabled?: boolean;

  @IsArray()
  @ArrayMaxSize(CHECKOUT_REQUIRED_FIELDS.length)
  @ArrayUnique()
  @IsIn(CHECKOUT_REQUIRED_FIELDS, { each: true })
  @IsOptional()
  requiredFields?: CheckoutRequiredField[];

  /** Optional — URL shown to customers in checkout footer. */
  @ValidateIf((_, v: string | null) => v !== null)
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  @IsOptional()
  termsOfServiceUrl?: string | null;

  /** Optional — where the storefront sends the customer after purchase. */
  @ValidateIf((_, v: string | null) => v !== null)
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  @IsOptional()
  postPurchaseRedirectUrl?: string | null;

  /** Optional marketing text shown above the payment methods block. */
  @IsString()
  @MaxLength(500)
  @IsOptional()
  checkoutMessage?: string | null;
}
