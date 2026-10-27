import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import {
  FEATURED_PRODUCTS_VARIANTS,
  TRUST_PILLAR_KINDS,
  type FeaturedProductsConfig,
  type FeaturedProductsVariant,
  type HeroSectionConfig,
  type CategoryShowcaseConfig,
  type PromotionalBannerConfig,
  type TrustPillarKind,
  type TrustSignalsConfig,
} from '@admin-services';

/**
 * Asset IDs are UUID (any version). Production uploads generate v4 via
 * `uuidv4()`; the catalogue seed pipeline generates v5 (namespace-derived)
 * for stable reseed IDs. Both are valid — validate any RFC 4122 UUID.
 * Category + Product IDs are Prisma cuid — relaxed [A-Za-z0-9_-]{1,64}.
 */
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const uuidValidators = [Validators.required, Validators.pattern(UUID_ANY)];
const entityIdValidators = [Validators.required, Validators.pattern(ENTITY_ID)];

const emptyTranslatable = (): Record<string, string> => ({ default: '' });

/**
 * Site-relative path or absolute http(s) URL only. Mirrors the backend
 * `apps/api/src/modules/storefront-config/dto/configs/cta-href.constants.ts`
 * regex per the S21 admin-security-reviewer H-2 finding — schemeless
 * `//evil.com`, `javascript:`, `data:`, `vbscript:`, `file:` and the
 * backslash variants are all rejected here so the admin form blocks the
 * value before it reaches the API.
 */
const CTA_HREF_SCHEME_REGEX = /^(\/[^/\\]|https?:\/\/)/;

const ctaHrefValidators = [
  Validators.required,
  Validators.minLength(1),
  Validators.maxLength(2000),
  Validators.pattern(CTA_HREF_SCHEME_REGEX),
];

const ctaHrefValidatorsOptional = [
  Validators.maxLength(2000),
  Validators.pattern(CTA_HREF_SCHEME_REGEX),
];

// ── Hero ────────────────────────────────────────────────────────────────────

export type HeroSectionForm = FormGroup<{
  assetId: FormControl<string>;
  eyebrow: FormControl<Record<string, string>>;
  headline: FormControl<Record<string, string>>;
  body: FormControl<Record<string, string>>;
  cta: FormControl<Record<string, string>>;
  ctaHref: FormControl<string>;
  imageAlt: FormControl<Record<string, string>>;
}>;

export function buildHeroSectionForm(
  fb: FormBuilder,
  initial?: HeroSectionConfig,
): HeroSectionForm {
  return fb.nonNullable.group({
    assetId: fb.nonNullable.control(initial?.assetId ?? '', uuidValidators),
    eyebrow: fb.nonNullable.control<Record<string, string>>(
      initial?.eyebrow ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    headline: fb.nonNullable.control<Record<string, string>>(
      initial?.headline ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    body: fb.nonNullable.control<Record<string, string>>(
      initial?.body ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    cta: fb.nonNullable.control<Record<string, string>>(
      initial?.cta ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    ctaHref: fb.nonNullable.control(initial?.ctaHref ?? '', ctaHrefValidators),
    imageAlt: fb.nonNullable.control<Record<string, string>>(
      initial?.imageAlt ?? emptyTranslatable(),
    ),
  });
}

// ── Promotional banner ──────────────────────────────────────────────────────

export type PromotionalBannerForm = FormGroup<{
  assetId: FormControl<string>;
  eyebrow: FormControl<Record<string, string>>;
  headline: FormControl<Record<string, string>>;
  body: FormControl<Record<string, string>>;
  cta: FormControl<Record<string, string>>;
  ctaHref: FormControl<string>;
  imageAlt: FormControl<Record<string, string>>;
}>;

export function buildPromotionalBannerForm(
  fb: FormBuilder,
  initial?: PromotionalBannerConfig,
): PromotionalBannerForm {
  return fb.nonNullable.group({
    assetId: fb.nonNullable.control(initial?.assetId ?? '', uuidValidators),
    eyebrow: fb.nonNullable.control<Record<string, string>>(
      initial?.eyebrow ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    headline: fb.nonNullable.control<Record<string, string>>(
      initial?.headline ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    body: fb.nonNullable.control<Record<string, string>>(
      initial?.body ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    cta: fb.nonNullable.control<Record<string, string>>(initial?.cta ?? emptyTranslatable()),
    ctaHref: fb.nonNullable.control(initial?.ctaHref ?? '', ctaHrefValidatorsOptional),
    imageAlt: fb.nonNullable.control<Record<string, string>>(
      initial?.imageAlt ?? emptyTranslatable(),
    ),
  });
}

// ── Category showcase ───────────────────────────────────────────────────────

export type CategoryShowcaseForm = FormGroup<{
  categoryIds: FormArray<FormControl<string>>;
  heading: FormControl<Record<string, string>>;
}>;

export function buildCategoryShowcaseForm(
  fb: FormBuilder,
  initial?: CategoryShowcaseConfig,
): CategoryShowcaseForm {
  const ids = initial?.categoryIds ?? [''];
  return fb.nonNullable.group({
    categoryIds: fb.nonNullable.array(
      ids.map((id) => fb.nonNullable.control(id, entityIdValidators)),
      [Validators.required, Validators.minLength(1)],
    ),
    heading: fb.nonNullable.control<Record<string, string>>(
      initial?.heading ?? emptyTranslatable(),
    ),
  });
}

// ── Featured products ───────────────────────────────────────────────────────

export type FeaturedProductsForm = FormGroup<{
  productIds: FormArray<FormControl<string>>;
  variant: FormControl<FeaturedProductsVariant>;
  heading: FormControl<Record<string, string>>;
  eyebrow: FormControl<Record<string, string>>;
}>;

export function buildFeaturedProductsForm(
  fb: FormBuilder,
  initial?: FeaturedProductsConfig,
): FeaturedProductsForm {
  const ids = initial?.productIds ?? [''];
  return fb.nonNullable.group({
    productIds: fb.nonNullable.array(
      ids.map((id) => fb.nonNullable.control(id, entityIdValidators)),
      [Validators.required, Validators.minLength(1)],
    ),
    variant: fb.nonNullable.control<FeaturedProductsVariant>(
      initial?.variant ?? FEATURED_PRODUCTS_VARIANTS[0],
      [Validators.required],
    ),
    heading: fb.nonNullable.control<Record<string, string>>(
      initial?.heading ?? emptyTranslatable(),
    ),
    eyebrow: fb.nonNullable.control<Record<string, string>>(
      initial?.eyebrow ?? emptyTranslatable(),
    ),
  });
}

// ── Trust signals ───────────────────────────────────────────────────────────

export type TrustSignalsForm = FormGroup<{
  items: FormArray<TrustSignalItemForm>;
}>;

export type TrustSignalItemForm = FormGroup<{
  kind: FormControl<TrustPillarKind>;
  title: FormControl<Record<string, string>>;
  subtitle: FormControl<Record<string, string>>;
}>;

export function buildTrustSignalsForm(
  fb: FormBuilder,
  initial?: TrustSignalsConfig,
): TrustSignalsForm {
  const items = initial?.items ?? [
    { kind: TRUST_PILLAR_KINDS[0], title: emptyTranslatable(), subtitle: emptyTranslatable() },
  ];
  return fb.nonNullable.group({
    items: fb.nonNullable.array(
      items.map((it) => buildTrustSignalItemForm(fb, it)),
      [Validators.required, Validators.minLength(1)],
    ),
  });
}

export function buildTrustSignalItemForm(
  fb: FormBuilder,
  initial?: {
    kind: TrustPillarKind;
    title: Record<string, string>;
    subtitle: Record<string, string>;
  },
): TrustSignalItemForm {
  return fb.nonNullable.group({
    kind: fb.nonNullable.control<TrustPillarKind>(initial?.kind ?? TRUST_PILLAR_KINDS[0], [
      Validators.required,
    ]),
    title: fb.nonNullable.control<Record<string, string>>(
      initial?.title ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
    subtitle: fb.nonNullable.control<Record<string, string>>(
      initial?.subtitle ?? emptyTranslatable(),
      requireDefaultLocale,
    ),
  });
}

// ── Validators ──────────────────────────────────────────────────────────────

function requireDefaultLocale(control: { value: Record<string, string> | null }) {
  const value = control.value;
  if (!value || typeof value !== 'object') return { required: true };
  const def = value['default'];
  if (typeof def !== 'string' || def.trim().length === 0) return { required: true };
  return null;
}
