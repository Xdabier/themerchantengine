import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { SectionType } from '@prisma/client';

import { HeroSectionConfigDto, HERO_ASSET_ID_PATHS } from './hero-section-config.dto';
import {
  PromotionalBannerConfigDto,
  PROMOTIONAL_BANNER_ASSET_ID_PATHS,
} from './promotional-banner-config.dto';
import {
  CategoryShowcaseConfigDto,
  CATEGORY_SHOWCASE_ASSET_ID_PATHS,
} from './category-showcase-config.dto';
import {
  FeaturedProductsConfigDto,
  FEATURED_PRODUCTS_ASSET_ID_PATHS,
} from './featured-products-config.dto';
import { TrustSignalsConfigDto, TRUST_SIGNALS_ASSET_ID_PATHS } from './trust-signals-config.dto';

export * from './hero-section-config.dto';
export * from './promotional-banner-config.dto';
export * from './category-showcase-config.dto';
export * from './featured-products-config.dto';
export * from './trust-signals-config.dto';

/**
 * The five surviving `SectionType` values per DR-05. Used by the admin DTO +
 * service layer to gate the discriminator union; the Prisma enum still
 * carries ten values until the S21 cutover migration drops the unused five.
 */
export const ALLOWED_SECTION_TYPES = [
  SectionType.HERO,
  SectionType.PROMOTIONAL_BANNER,
  SectionType.CATEGORY_SHOWCASE,
  SectionType.FEATURED_PRODUCTS,
  SectionType.TRUST_SIGNALS,
] as const;

export type AllowedSectionType = (typeof ALLOWED_SECTION_TYPES)[number];

const CONFIG_DTO_BY_TYPE: Record<AllowedSectionType, new () => object> = {
  [SectionType.HERO]: HeroSectionConfigDto,
  [SectionType.PROMOTIONAL_BANNER]: PromotionalBannerConfigDto,
  [SectionType.CATEGORY_SHOWCASE]: CategoryShowcaseConfigDto,
  [SectionType.FEATURED_PRODUCTS]: FeaturedProductsConfigDto,
  [SectionType.TRUST_SIGNALS]: TrustSignalsConfigDto,
};

const ASSET_ID_PATHS_BY_TYPE: Record<AllowedSectionType, ReadonlyArray<readonly string[]>> = {
  [SectionType.HERO]: HERO_ASSET_ID_PATHS,
  [SectionType.PROMOTIONAL_BANNER]: PROMOTIONAL_BANNER_ASSET_ID_PATHS,
  [SectionType.CATEGORY_SHOWCASE]: CATEGORY_SHOWCASE_ASSET_ID_PATHS,
  [SectionType.FEATURED_PRODUCTS]: FEATURED_PRODUCTS_ASSET_ID_PATHS,
  [SectionType.TRUST_SIGNALS]: TRUST_SIGNALS_ASSET_ID_PATHS,
};

/**
 * Per-section-type asset intent. Maps the DR-04 section types to the
 * `agent_docs/assets-pipeline.md` §2 canonical-variant intents.
 * Used by `StorefrontConfigService.hydrateAssetUrls` to pick the right
 * variant size for each surface.
 */
import type { AssetIntent } from '@common/asset-variants';

export const SECTION_ASSET_INTENT: Record<AllowedSectionType, AssetIntent> = {
  [SectionType.HERO]: 'hero',
  [SectionType.PROMOTIONAL_BANNER]: 'banner',
  [SectionType.CATEGORY_SHOWCASE]: 'card',
  [SectionType.FEATURED_PRODUCTS]: 'card',
  [SectionType.TRUST_SIGNALS]: 'thumbnail',
};

export function isAllowedSectionType(type: SectionType): type is AllowedSectionType {
  return (ALLOWED_SECTION_TYPES as ReadonlyArray<SectionType>).includes(type);
}

/**
 * Returns every `(type, path)` tuple where a per-type config schema declares
 * an `assetId` reference. Used by `StorefrontConfigService.findSectionsByAssetId`
 * to build the JSONB-path query that DR-07 hard-delete consults.
 */
export function getAssetIdReferencePaths(): ReadonlyArray<{
  type: AllowedSectionType;
  path: readonly string[];
}> {
  const out: { type: AllowedSectionType; path: readonly string[] }[] = [];
  for (const type of ALLOWED_SECTION_TYPES) {
    for (const path of ASSET_ID_PATHS_BY_TYPE[type]) {
      out.push({ type, path });
    }
  }
  return out;
}

function flattenErrors(errors: ValidationError[], parentPath = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints) {
      for (const message of Object.values(err.constraints)) {
        out.push(`${path}: ${message}`);
      }
    }
    if (err.children?.length) {
      out.push(...flattenErrors(err.children, path));
    }
  }
  return out;
}

/**
 * Validates a section's `config` JSONB against the per-type DTO selected by
 * the `type` discriminator. Enforces `whitelist + forbidNonWhitelisted` even
 * if the global pipe is more permissive, so unknown fields on the JSONB
 * surface are explicitly rejected rather than silently stripped.
 *
 * Throws `BadRequestException` with the flattened constraint messages when
 * the config does not match the per-type shape. Returns the validated DTO
 * instance so callers can persist a sanitised copy.
 */
export async function validateSectionConfig<T extends AllowedSectionType>(
  type: T,
  config: unknown,
): Promise<object> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new BadRequestException(`config must be a JSON object matching the ${type} schema`);
  }

  const Ctor = CONFIG_DTO_BY_TYPE[type];
  const instance = plainToInstance(Ctor, config, { enableImplicitConversion: false });
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    stopAtFirstError: false,
  });

  if (errors.length > 0) {
    throw new BadRequestException({
      message: `Invalid config for section type ${type}`,
      errors: flattenErrors(errors),
    });
  }

  return instance;
}
