---
title: Add a home section type
description: "How a home-page section type travels from the Prisma enum through the API's per-type config DTO, the admin editor, the storefront's Zod union and the component map, using the trust-signals strip as the worked example."
primaryQuery: add a home page section type ecommerce storefront admin editor
updated: 2026-09-09
schema: HowTo
---

## When you need this

The home page is a list of `StorefrontSection` rows the operator orders in the admin, each with a `type` and a type-specific `config`. Five types exist: `HERO`, `PROMOTIONAL_BANNER`, `CATEGORY_SHOWCASE`, `FEATURED_PRODUCTS` and `TRUST_SIGNALS`. You want a sixth, for example a testimonial band. A type is one value that has to agree in five places, and each place has a guard that fails when it does not. This page follows `TRUST_SIGNALS` through all five. You end with a type the admin can create, the API validates, and the storefront renders.

## Files you touch

- `prisma/schema.prisma`: `enum SectionType`, the storage value. Add the member, write the migration by hand, and run `npx prisma generate`.
- `apps/api/src/modules/storefront-config/dto/configs/trust-signals-config.dto.ts`: the class-validator shape of `config` for one type, plus its list of `assetId` JSON paths.
- `apps/api/src/modules/storefront-config/dto/configs/index.ts`: `ALLOWED_SECTION_TYPES`, the DTO-by-type map, the asset-intent map and `validateSectionConfig`.
- `libs/admin-services/src/storefront-config/section-config.schemas.ts`: the admin's strict Zod schema for the same config.
- `libs/admin-services/src/storefront-config/storefront-config.schemas.ts`: `sectionTypeSchema` (the `z.enum` the selector lists), the `storefrontSectionSchema` union and the `createSectionRequestSchema` union all gain a member.
- `apps/admin/src/app/features/storefront/section-editor.page.ts`: the type selector and the per-type form switch; `apps/admin/src/app/features/storefront/section-editors/trust-signals-section-editor.component.ts` and `apps/admin/src/app/features/storefront/section-editors/build-config-forms.ts` hold the form for one type, and `apps/admin/src/app/features/storefront/section-editors/index.ts` is the barrel that exports both.
- `apps/admin/src/app/features/storefront/storefront.utils.ts`: `SECTION_TYPE_LABELS`, the label the admin list shows.
- `libs/storefront-types/src/lib/storefront-config/sections.schemas.ts`: `SECTION_TYPES` and the discriminated union the storefront parses. `libs/storefront-types/src/lib/storefront-config/sections.schemas.spec.ts` pins `SECTION_TYPES` to the five literals at line 30; extend that assertion.
- `apps/storefront/src/lib/section-component-map.ts`: type to component, typed as `Record<SectionType, Type<unknown>>`.
- `apps/storefront/src/app/pages/[locale]/index.page.ts`: `inputsFor(section)`, the switch that turns a row into the inputs of the component that renders it, for example `apps/storefront/src/app/sections/home/trust-strip.component.ts`.

## The pattern

### 1. Add the enum member and write the migration by hand

`prisma/schema.prisma` holds the storage value:

```prisma
enum SectionType {
  HERO
  FEATURED_PRODUCTS
  CATEGORY_SHOWCASE
  PROMOTIONAL_BANNER
  TRUST_SIGNALS
}
```

Add the member, then write the migration folder yourself. `npx prisma migrate dev` is not usable in this repository (the migration chain does not start from an empty database; see [Add a model](../data/add-a-model.md)), and the deployed schema is applied with `prisma db push`, so the folder is the written record. The model to copy is `prisma/migrations/20260830120000_shipment_status_cancelled/migration.sql`, whose only statement is:

```sql
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
```

Then regenerate the client. `SectionType.<YourMember>` in the API is read from the generated client, so until `prisma generate` has run the API does not compile.

```bash
npm run db:push
npm run prisma:generate
```

### 2. Define the config shape on the API

`apps/api/src/modules/storefront-config/dto/configs/trust-signals-config.dto.ts` is the whole contract for one type. Text is `Translatable`, bounds are explicit, and the file exports the JSON paths that hold asset ids so a deleted asset can find the sections that reference it:

```ts
export const TRUST_PILLAR_KINDS = ['delivery', 'returns', 'authentic', 'support'] as const;

export class TrustSignalItemDto {
  @IsIn(TRUST_PILLAR_KINDS)
  kind: TrustPillarKind;

  @ValidateNested()
  @Type(() => TranslatableDto)
  title: TranslatableDto;

  @ValidateNested()
  @Type(() => TranslatableDto)
  subtitle: TranslatableDto;
}

export class TrustSignalsConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => TrustSignalItemDto)
  items: TrustSignalItemDto[];
}

export const TRUST_SIGNALS_ASSET_ID_PATHS: ReadonlyArray<readonly string[]> = [];
```

### 3. Register it in the three maps

`apps/api/src/modules/storefront-config/dto/configs/index.ts` is where a type becomes accepted. `CreateSectionAdminDto` validates `type` with `@IsIn(ALLOWED_SECTION_TYPES)`, and the service refuses a type outside the list at create and update:

```ts
export const ALLOWED_SECTION_TYPES = [
  SectionType.HERO,
  SectionType.PROMOTIONAL_BANNER,
  SectionType.CATEGORY_SHOWCASE,
  SectionType.FEATURED_PRODUCTS,
  SectionType.TRUST_SIGNALS,
] as const;

const CONFIG_DTO_BY_TYPE: Record<AllowedSectionType, new () => object> = {
  [SectionType.TRUST_SIGNALS]: TrustSignalsConfigDto,
  // ...
};
```

`CONFIG_DTO_BY_TYPE`, `ASSET_ID_PATHS_BY_TYPE` and `SECTION_ASSET_INTENT` are all `Record<AllowedSectionType, ...>`, so a member added to `ALLOWED_SECTION_TYPES` without an entry in each map is a compile error. `validateSectionConfig(type, config)` in the same file runs the selected DTO with `whitelist`, `forbidNonWhitelisted` and `forbidUnknownValues`, so an unknown key in `config` is a 400, not a silent strip. The asset intent picks the variant size `StorefrontConfigService.hydrateAssetUrls` writes into `config` before the row reaches the storefront.

### 4. Give the admin a form

`apps/admin/src/app/features/storefront/section-editor.page.ts` holds one form signal per type and switches on the selector:

```ts
readonly sectionTypes = sectionTypeSchema.options;

readonly activeConfigForm = computed<ConfigForm | null>(() => {
  switch (this.activeType()) {
    case 'HERO':
      return this.heroForm();
    // ... one case per type
    case 'TRUST_SIGNALS':
      return this.trustSignalsForm();
  }
});
```

The template has a matching `@switch (activeType())` with one `@case` per type that mounts the editor component. The form builder for a type lives in `build-config-forms.ts`:

```ts
export function buildTrustSignalsForm(fb: FormBuilder, initial?: TrustSignalsConfig): TrustSignalsForm {
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
```

The Zod side in `libs/admin-services/src/storefront-config/section-config.schemas.ts` is `.strict()` and mirrors the DTO bounds (`items: z.array(trustSignalItemSchema).min(1).max(6)`). The envelope schemas live next to it in `libs/admin-services/src/storefront-config/storefront-config.schemas.ts`: `sectionTypeSchema` is the `z.enum` the selector's `sectionTypes` reads, and both `storefrontSectionSchema` and `createSectionRequestSchema` are `z.discriminatedUnion('type', [...])` lists with one member per type. A type missing from any of the three is either absent from the selector or rejected when the list response is parsed. Export the new editor component and its form builder from `apps/admin/src/app/features/storefront/section-editors/index.ts`, and add the label to `SECTION_TYPE_LABELS` in `apps/admin/src/app/features/storefront/storefront.utils.ts`; an unlisted type falls back to `humanizeCode`.

### 5. Teach the storefront to parse it

`libs/storefront-types/src/lib/storefront-config/sections.schemas.ts` lists the types and builds a discriminated union on `type`:

```ts
export const SECTION_TYPES = ['HERO', 'PROMOTIONAL_BANNER', 'CATEGORY_SHOWCASE', 'FEATURED_PRODUCTS', 'TRUST_SIGNALS'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

const trustSignalsConfigSchema = z
  .object({ items: z.array(trustSignalItemSchema).min(1).max(6) })
  .passthrough();

export const trustSignalsSectionSchema = z
  .object({ ...baseSectionFields, type: z.literal('TRUST_SIGNALS'), config: trustSignalsConfigSchema })
  .passthrough();

export const storefrontSectionSchema = z.discriminatedUnion('type', [ /* one per type */ ]);
```

### 6. Bind a component and map the inputs

`apps/storefront/src/lib/section-component-map.ts` is typed so a missing binding fails the build:

```ts
export const SECTION_COMPONENT_MAP: Record<SectionType, Type<unknown>> = {
  HERO: HeroBannerComponent,
  // ...
  TRUST_SIGNALS: TrustStripComponent,
};
```

`apps/storefront/src/app/pages/[locale]/index.page.ts` renders `@for (section of sections())` through `*ngComponentOutlet="componentFor(section); inputs: inputsFor(section)"`, and `inputsFor` narrows on `type`:

```ts
case 'TRUST_SIGNALS': {
  const pillars: TrustPillar[] = section.config.items.map((it) => ({
    kind: it.kind,
    title: pickTranslation(it.title, loc),
    subtitle: pickTranslation(it.subtitle, loc),
  }));
  return { pillars, title: section.title ? pickTranslation(section.title, loc) : null, headingId: `home-trust-${section.id}` };
}
default: {
  const _exhaustive: never = section;
  return _exhaustive;
}
```

The `never` default is the second compile-time gate. The component takes the row through inputs and falls back to chrome copy when the row carries none (`apps/storefront/src/app/sections/home/trust-strip.component.ts`, `pillars = input<TrustPillar[] | null>(null)`). Write a new component for the new type: `apps/storefront/src/lib/section-component-map.spec.ts` (lines 31-35) requires every value in the map to be a distinct component, so binding an existing one to the new key fails that spec.

### 7. Guard every optional array at the read site

Where the schema leaves a field optional, the consumer guards the read. `apps/storefront/src/app/sections/home/hero-banner.component.ts` and `campaign-banner.component.ts` do it on the image ladder:

```ts
protected readonly heroImageSources = computed(() => this.resolvedCopy().imageSources ?? []);
```

A `.map`, `.filter` or `.length` on an undefined field throws inside a `computed()` and renders the section empty without failing any assertion, which is what the console baseline in the journey specs exists to catch.

## Tests to run

```bash
npx tsc --noEmit -p apps/api/tsconfig.build.json
npx tsc --noEmit -p apps/storefront/tsconfig.app.json
npx nx build admin --configuration=production
npx nx test api
npx nx test admin
npx nx test storefront-types
npx nx test storefront
npx nx e2e admin-e2e --grep=storefront-section-editor
npx nx e2e storefront-e2e --grep=home-sections
```

- The two `tsc` lines are the only commands on this list that run the compile-time gates of steps 3 and 6 (the `Record<AllowedSectionType, ...>` maps and the `never` default). `apps/api/jest.config.ts` (lines 32-40) transforms with ts-jest under `isolatedModules: true`, which does not type-check, and Vitest never type-checks source files, so `npx nx test api` and `npx nx test storefront` pass with a map entry missing. Use `apps/api/tsconfig.build.json`, not `apps/api/tsconfig.app.json`: the latter includes spec files under `apps/api/scripts/` and `libs/shared/common/` without the Jest types and reports hundreds of unrelated errors.
- `npx nx build admin --configuration=production` is the AOT build, the only command that compiles the editor template. `apps/admin/src/app/features/storefront/section-editor.page.spec.ts` sets the selector to `TRUST_SIGNALS` and asserts which form signal is live; it does not mount the `@case` for a type, so a missing `@case` passes Jest and fails here.
- `npx nx test api` runs `apps/api/src/modules/storefront-config/storefront-config.service.spec.ts`, including the rejected-type and unknown-config-key paths.
- `npx nx test admin` runs `apps/admin/src/app/features/storefront/section-editor.page.spec.ts`.
- `npx nx test storefront-types` runs `libs/storefront-types/src/lib/storefront-config/sections.schemas.spec.ts`, the union parse.
- `npx nx test storefront` runs `apps/storefront/src/lib/section-component-map.spec.ts`, which asserts the map holds exactly `SECTION_TYPES`, and the home page spec.
- The admin journey `apps/admin-e2e/src/modules/storefront-section-editor.journey.spec.ts` drives the editor. The storefront journey `apps/storefront-e2e/src/home-sections.journey.spec.ts` creates a section through `POST /v1/admin/storefront/pages/home/sections`, reads it back on `GET /v1/storefront/sections/home` and asserts the home page renders it, then reloads.

## Gotchas

- The public list applies `isVisible`, `visibleFrom` and `visibleUntil` in `StorefrontConfigService` before the storefront sees a row. A section that saves fine and never shows is usually outside its window.
- `hydrateAssetUrls` only visits the JSON paths a type declares in its `*_ASSET_ID_PATHS`. A new type with an image and an empty path list ships `assetId` with no URL.
- Dropping a type from the storefront map while the admin still offers it is a dead knob: the operator configures a section nobody sees and gets no error. `section-component-map.spec.ts` pins the map to `SECTION_TYPES` so this cannot be done quietly.
- A section save emits `STOREFRONT_SECTION_UPDATED_EVENT` (`apps/api/src/modules/storefront-config/storefront-config.events.ts`); the webhooks module posts it to the storefront's `apps/storefront/src/server/routes/api/_internal/revalidate.post.ts`, which checks `X-Revalidate-Secret` in constant time. Both processes must share `STOREFRONT_REVALIDATE_SECRET`.
- The storefront schemas are `.passthrough()` and the admin ones `.strict()`. That is deliberate: the storefront tolerates a field the API adds, the admin refuses to send one the API would reject with `forbidNonWhitelisted`.
- The API config DTO validates `Translatable` text as `{ default, <locale> }` objects; the storefront resolves them with `pickTranslation(value, locale)` in `inputsFor`. Do not send a plain string from the admin.
- `TrustStripComponent` renders the chrome-copy pillars when the row carries none, so an empty test payload still shows four pillars. Assert on the operator's text, not on the count.
