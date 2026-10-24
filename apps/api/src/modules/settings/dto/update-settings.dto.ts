import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { MONEY_DECIMAL_PLACES } from '@common/money';

import {
  IsRegistryLocale,
  TranslatableLocaleKeysDto,
} from '../../../common/dto/translatable-locale-keys.dto';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const HTTPS_ORIGIN = /^$|^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/;
const COUNTRY_CODE = /^$|^[A-Z]{2}$/;
/** IANA zone or UTC, the same shape the wire contract accepts. */
const TIMEZONE = /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$|^UTC$/;
/** E.164 with no separators, or empty until set; the composer strips spaces. */
const E164_OR_EMPTY = /^$|^\+[1-9][0-9]{6,14}$/;
export const FONT_KITS = ['latin-rounded', 'arabic-latin'] as const;
export const SYMBOL_POSITIONS = ['before', 'after'] as const;
export const TAX_DISPLAYS = ['HT', 'TTC', 'none'] as const;

/**
 * The palette generator inputs. `secondary` and `accent` are nullable rather
 * than optional: a null clears the colour, an absent key leaves it alone, and
 * the whole object is replaced on write like every other JSON row.
 */
export class BaseColorsDto {
  @IsString()
  @Matches(HEX_COLOR, { message: 'primary must be a six-digit hex colour' })
  primary: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(HEX_COLOR, { message: 'secondary must be a six-digit hex colour or null' })
  secondary: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(HEX_COLOR, { message: 'accent must be a six-digit hex colour or null' })
  accent: string | null;
}

/**
 * Empty, an absolute `http(s)` URL, or a site-relative path.
 *
 * Anything else, `javascript:` and `data:` included, is refused: these values
 * are rendered straight into an `<img src>` and into the Organization JSON-LD.
 */
const APPEARANCE_URL_PATTERN = /^$|^https?:\/\/\S+$|^\/[^\s]*$/;

/**
 * Individual locale configuration for updates.
 */
export class LocaleConfigDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  symbol?: string;

  @IsOptional()
  @Type(() => Number)
  decimalPlaces?: number;
}

/**
 * Currency configuration for updates.
 *
 * Every field is bounded because this row is no longer inert: the admin reads it
 * on every screen through `GET /v1/admin/currencies/store`, so an unbounded
 * `decimalPlaces` would make `Intl.NumberFormat` throw on every money render
 * dashboard-wide, and an unbounded `symbol` would ship on every hydration.
 * Three is the ceiling because storage is `Decimal(12, 3)` and the public
 * config contract caps display precision there too.
 * `code` stays a shape check rather than a catalogue allowlist so a deliberate
 * client can still store a currency the picker does not offer.
 */
export class CurrencyConfigDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/)
  code: string;

  @IsString()
  @IsOptional()
  @MaxLength(8)
  symbol?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  decimalPlaces?: number;
}

/**
 * Flexible settings update DTO.
 *
 * Accepts any setting key (validated against SETTINGS_KEYS) with values appropriate
 * to each setting type. The controller deserializes and validates individual fields.
 *
 * Examples:
 *   { supportedLocales: ["fr", "en"], defaultLocale: "fr" }
 *   { guestCheckoutEnabled: true, minimumOrderAmount: 50 }
 *   { windowDays: 30, autoApprove: true }
 */
/**
 * The store name and description are Translatable like every catalogue field:
 * `default` required, one optional key per catalogue locale, each refused when
 * the store has not enabled it, any other key refused by the whitelist.
 */
export class SettingsTranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  default!: string;
}

export class UpdateSettingsDto {
  // General
  // IsObject first: ValidateNested alone iterates an array and finds nothing to fail.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsTranslatableDto)
  storeName?: SettingsTranslatableDto;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @Matches(E164_OR_EMPTY, { message: 'phone must be E.164 with no separators, or empty' })
  phone?: string;

  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, unknown>;

  // Localization
  @IsOptional()
  @IsArray()
  @IsRegistryLocale({ each: true })
  supportedLocales?: string[];

  @IsOptional()
  @IsRegistryLocale()
  defaultLocale?: string;

  @IsOptional()
  @IsString()
  @Matches(TIMEZONE, { message: 'timezone must be an IANA zone such as Europe/Paris, or UTC' })
  timezone?: string;

  /**
   * Locales rendered right-to-left. Must be a registry locale here; the
   * service holds it to being a subset of `supportedLocales` at write time,
   * because the two keys can arrive in separate PATCHes.
   */
  @IsOptional()
  @IsArray()
  @IsRegistryLocale({ each: true })
  rtlLocales?: string[];

  // Identity
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, {
    message: 'brandName must be a lowercase slug of at most 40 characters',
  })
  brandName?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsTranslatableDto)
  description?: SettingsTranslatableDto;

  // Brand
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BaseColorsDto)
  baseColors?: BaseColorsDto;

  @IsOptional()
  @IsIn(FONT_KITS)
  fontKit?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  logoAssetId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  faviconAssetId?: string | null;

  // Money
  @IsOptional()
  @IsIn(SYMBOL_POSITIONS)
  symbolPosition?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1)
  decimalSeparator?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1)
  thousandsSeparator?: string;

  @IsOptional()
  @IsIn(TAX_DISPLAYS)
  taxDisplay?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  @Type(() => Number)
  vatRate?: number;

  // Domains: an `https://` origin with no path, or empty to fall back to the
  // environment variable.
  @IsOptional()
  @IsString()
  @Matches(HTTPS_ORIGIN, { message: 'storefront must be an https:// origin or empty' })
  storefront?: string;

  @IsOptional()
  @IsString()
  @Matches(HTTPS_ORIGIN, { message: 'admin must be an https:// origin or empty' })
  admin?: string;

  @IsOptional()
  @IsString()
  @Matches(HTTPS_ORIGIN, { message: 'api must be an https:// origin or empty' })
  api?: string;

  // `@IsObject()` alongside the nested validation: without it an array passes
  // (ValidateNested without `each` accepts one and finds no elements to fail),
  // and the stored value stops being the object every reader expects.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CurrencyConfigDto)
  currencyConfig?: CurrencyConfigDto;

  // Checkout
  @IsOptional()
  @Type(() => Boolean)
  guestCheckoutEnabled?: boolean;

  // The only money setting in the API that carried no numeric validation at
  // all: `@IsOptional() @Type(() => Number)` and nothing else, so a string, a
  // negative, or an arbitrary-scale value all reached the column.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  minimumOrderAmount?: number;

  // Inventory
  @IsOptional()
  @Type(() => Number)
  defaultLowStockThreshold?: number;

  @IsOptional()
  @IsObject()
  reservationSettings?: Record<string, unknown>;

  // Orders
  @IsOptional()
  @IsString()
  numberPrefix?: string;

  @IsOptional()
  @IsString()
  numberFormat?: string;

  @IsOptional()
  @IsObject()
  cancellationPolicy?: Record<string, unknown>;

  // Returns
  @IsOptional()
  @Type(() => Number)
  windowDays?: number;

  @IsOptional()
  @Type(() => Boolean)
  requirePhotos?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  autoApprove?: boolean;

  // Shipping
  @IsOptional()
  @IsString()
  defaultHandlingTime?: string;

  @IsOptional()
  @IsString()
  cutOffTime?: string;

  // Notifications
  /**
   * Global "pause all email" kill-switch (NE6). Declared here so the
   * whitelist:true ValidationPipe does not strip it from the PATCH body before
   * it reaches updateMany → the notifications/pauseAll StoreSetting row.
   */
  @IsOptional()
  @IsBoolean()
  pauseAll?: boolean;

  // Business
  /**
   * Link 3 of four, and the hardest failure of them. `main.ts` runs the
   * ValidationPipe with `forbidNonWhitelisted: true`, so a key present in the
   * store config, in the key registry and in the admin form but absent HERE is
   * rejected at runtime with a 400 and no compile error anywhere.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxRegistrationNumber?: string;

  /**
   * The legal entity, its trading name and its street address.
   *
   * Registered in `SETTINGS_KEYS` and defined in `store.config.ts` since the
   * business group shipped, and absent here, which is the same defect the
   * comment above `taxRegistrationNumber` describes: the pipe runs with
   * `forbidNonWhitelisted`, so a key the operator can see and the storefront
   * renders was a 400 on write. The invoice renderer and the Organization
   * JSON-LD both read `legalName`, so it was seed-only in practice.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsTranslatableDto)
  legalName?: SettingsTranslatableDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsTranslatableDto)
  tradingName?: SettingsTranslatableDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsTranslatableDto)
  streetAddress?: SettingsTranslatableDto;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressLocality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressRegion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @Matches(COUNTRY_CODE, { message: 'addressCountry must be an ISO 3166-1 alpha-2 code' })
  addressCountry?: string;

  // Appearance
  /**
   * The operator's logo and favicon.
   *
   * Empty string clears back to the baked artwork; `StoreSetting.value` is a
   * non-nullable Json column, so `''` rather than `null` is how every cleared
   * string setting is stored here.
   *
   * The pattern allows an absolute `http(s)` URL or a site-relative path, and
   * nothing else. It is the same shape `apps/storefront/src/lib/seo.ts`
   * resolves, and it is what keeps a `javascript:` value out of a page that
   * renders the logo into markup.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(APPEARANCE_URL_PATTERN, {
    message: 'must be empty, an absolute http(s) URL, or a site-relative path',
  })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(APPEARANCE_URL_PATTERN, {
    message: 'must be empty, an absolute http(s) URL, or a site-relative path',
  })
  faviconUrl?: string;
}
