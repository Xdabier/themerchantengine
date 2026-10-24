---
title: Change checkout fields
description: "The shipping address shape on the API and the storefront, the phone and postal-code rules on both sides, how a rejected order surfaces as a stable error code and a localized message, and the tests that pin each half."
primaryQuery: change checkout address fields nestjs angular storefront validation
updated: 2026-09-09
schema: HowTo
---

## When you need this

You want to add, drop or tighten a field on the checkout address, for example a required postal code or a delivery instruction. The address is typed in four places that must agree: the API DTO that accepts the order, the storefront Zod schemas that type the order payload, the schema that types a saved address the API returns, and the Reactive Form the customer fills. A rule enforced on only one side either blocks a valid order or lets a bad one through to the API's generic `VALIDATION_ERROR`. This page follows the phone field, which has a real rule on both sides, and shows where an order-level refusal turns into a code and a localized message.

## Files you touch

- `apps/api/src/modules/orders/dto/create-order.dto.ts`: `AddressDto`, the inline shipping and billing address on `POST /v1/orders`.
- `apps/api/src/modules/users/dto/customer/create-address.dto.ts`: the saved-address DTO, which carries the phone and country rules.
- `libs/shared/common/src/utils/phone.ts`: `PHONE_RE` and `normalizePhone`, the API's phone rule.
- `libs/storefront-types/src/lib/users/users.schemas.ts` and `libs/storefront-types/src/lib/orders/orders.schemas.ts`: the storefront's address input types. `orderAddressInputSchema` (lines 14-24 of the orders file) is its own `z.object`, not derived from `addressInputBase`, so a field is added to each.
- `libs/storefront-types/src/lib/shared/entities.ts`: `addressSchema` and the `Address` response type (lines 229-245), the shape of a saved address the API returns. `toOrderAddress` in the checkout page reads from this type.
- `apps/storefront/src/lib/phone.ts`: the storefront copy of the phone rule.
- `apps/storefront/src/app/sections/checkout/address-picker.component.ts`: the inline form on the checkout address step; `apps/storefront/src/app/sections/account/address-form.component.ts` is the saved-address form with the same validators.
- `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts`: `placeOrderErrorMessageFor`, the code-to-string switch.
- `apps/storefront/src/i18n/types.ts` and the three catalogues: `checkout.errors.*`.
- `apps/api/src/modules/orders/order-guest-address-required.exception.ts`: the shape of a typed refusal.

## The pattern

### 1. Start from the API's address

`apps/api/src/modules/orders/dto/create-order.dto.ts` accepts the inline address a guest sends and an account customer never does:

```ts
class AddressDto {
  @IsString()
  fullName!: string;

  @IsString()
  phone!: string;

  @IsString()
  addressLine1!: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country!: string;
}
```

The saved-address DTO in `apps/api/src/modules/users/dto/customer/create-address.dto.ts` is stricter on phone and normalises it before matching:

```ts
@IsString()
@Transform(({ value }) => normalizePhone(value))
@Matches(PHONE_RE, { message: 'Invalid phone number format' })
phone: string;

@IsOptional()
@IsString()
@MaxLength(20)
postalCode?: string;
```

`PHONE_RE` in `libs/shared/common/src/utils/phone.ts` is `/^\+?[0-9]{6,15}$/`, applied after `normalizePhone` strips spaces, dots, hyphens and parentheses. There is no per-country phone shape and no postal-code format. `postalCode` is optional everywhere, but the twenty-character cap is not on every side: the saved-address DTO, the storefront Zod input and the form carry `MaxLength(20)`, while the inline `AddressDto` on the order (`create-order.dto.ts` lines 25-27) has `@IsOptional() @IsString()` and no length rule. A DTO failure answers 400 with `error.code` `VALIDATION_ERROR` and the flattened field list in `details`, built by the global pipe in `apps/api/src/main.ts` with `whitelist` and `forbidNonWhitelisted`, so an unknown field is also a 400.

### 2. Mirror the shape on the storefront

`libs/storefront-types/src/lib/users/users.schemas.ts` types the same object for the storefront:

```ts
const phonePattern = /^\+?[0-9]{6,15}$/;

const addressInputBase = {
  fullName: z.string().max(100),
  phone: z.string().regex(phonePattern, 'Invalid phone number format'),
  addressLine1: z.string().max(255),
  city: z.string().max(100),
  postalCode: z.string().max(20).optional(),
  country: z.string().regex(/^[A-Z]{2}$/, 'Country must be a valid ISO 3166-1 alpha-2 code (e.g. US, GB)'),
};
```

The form rule lives in `apps/storefront/src/lib/phone.ts`, which allows grouping characters between the digits because the API strips them:

```ts
export const PHONE_RE = /^\+?(?:[\s().-]*[0-9]){6,15}[\s().-]*$/;
```

That file does not import the API's copy, and the two regexes differ on purpose: the form accepts grouping characters the API strips, so the same string passes both. Nothing in lint forbids the import: `.eslintrc.js` lets `scope:storefront` depend on `scope:shared`, and `apps/storefront/src/i18n/types.ts` already imports from `@common/`. The cost is elsewhere: a `@common/*` import in a file Nitro bundles needs an entry in `nitro.alias` (see [Add a Nitro alias](./add-a-nitro-alias.md)). Change both regexes together or the form accepts what the API refuses.

A saved address the API returns is typed a third time, in `libs/storefront-types/src/lib/shared/entities.ts` (lines 229-245):

```ts
export const addressSchema = z
  .object({
    id: entityIdSchema,
    fullName: z.string(),
    phone: z.string(),
    addressLine1: z.string(),
    city: z.string(),
    postalCode: z.string().nullable().optional(),
    country: z.string().length(2),
  })
  .passthrough();
export type Address = z.infer<typeof addressSchema>;
```

It is `.passthrough()`, so a field you forget to declare here is not stripped and does not fail at the Zod layer. It surfaces as a type error instead: `toOrderAddress` in `checkout/index.page.ts` reads `addr.<field>` off `Address`, and an undeclared key on a passthrough type comes from its index signature as `unknown`, so `tsc` reports `TS4111` on the read and `TS2322` when the value is assigned to the `string` the order input expects. `npx tsc --noEmit -p apps/storefront/tsconfig.app.json` and the production build fail on it; `npx nx test storefront` does not, because Vitest strips types without checking them. `orderAddressInputSchema` in `libs/storefront-types/src/lib/orders/orders.schemas.ts` (lines 14-24) is the fourth declaration, its own object rather than a derivation of `addressInputBase`.

### 3. Change the form

`apps/storefront/src/app/sections/checkout/address-picker.component.ts` builds the inline form with the same maxima as the DTO:

```ts
fullName: ['', [Validators.required, Validators.maxLength(100)]],
phone: ['', [Validators.required, Validators.pattern(PHONE_RE)]],
addressLine1: ['', [Validators.required, Validators.maxLength(255)]],
addressLine2: ['', [Validators.maxLength(255)]],
city: ['', [Validators.required, Validators.maxLength(100)]],
state: ['', [Validators.maxLength(100)]],
postalCode: ['', [Validators.maxLength(20)]],
country: [this.defaultCountry(), [Validators.required, Validators.pattern(COUNTRY_RE)]],
```

Each input carries `aria-describedby` and `aria-invalid` bound to `showError(name)`, and the message under it is a chrome string, for example `strings().checkout.errors.invalidPhone`. The submit trims optional fields and omits the empty ones, so an empty `postalCode` never travels as `""`. On place-order, `checkout/index.page.ts` sends `shippingAddress: toOrderAddress(addr)` with `guestEmail` for a guest and `shippingAddressId` for an account customer.

### 4. Give an order-level refusal a code

A rule that only the service can check throws a typed exception. `apps/api/src/modules/orders/order-guest-address-required.exception.ts`:

```ts
export class OrderGuestAddressRequiredException extends BadRequestException {
  static readonly CODE = 'ORDER_GUEST_ADDRESS_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: OrderGuestAddressRequiredException.CODE,
        message: 'A shipping address is required to check out as a guest',
      },
    });
  }
}
```

`OrdersService.createOrder` throws it when a guest order arrives without `shippingAddress`. The storefront maps codes to strings in `checkout/index.page.ts` (lines 811-833). Abridged; the full switch also maps `ORDER_IDEMPOTENCY_IN_PROGRESS`, `SHIPPING_METHOD_INVALID` and `ORDER_PAYMENT_METHOD_INVALID` to their own strings and returns `errors.generic` for a `StorefrontUnauthorizedError` while the submit handler navigates to login:

```ts
private placeOrderErrorMessageFor(err: unknown): string {
  const errors = this.strings().checkout.errors;
  const code = err !== null && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : null;
  if (code === 'ORDER_INSUFFICIENT_STOCK') return errors.outOfStock;
  if (code === 'ORDER_CART_EMPTY') return errors.cartEmpty;
  if (code === 'SHIPPING_UNAVAILABLE') return errors.shippingUnavailable;
  if (code === 'ORDER_PAYMENT_METHOD_UNAVAILABLE') return errors.paymentMethodUnavailable;
  if (code === 'ORDER_GUEST_CHECKOUT_DISABLED') return errors.guestCheckoutDisabled;
  // ... four more branches, listed above
  if (err instanceof StorefrontConflictError) return errors.paymentRefused;
  if (err instanceof StorefrontError) return errors.generic;
  return errors.networkUnavailable;
}
```

A new code needs a line here and a key under `checkout.errors` in `apps/storefront/src/i18n/types.ts`, filled in `fr.ts`, `en.ts` and `ar.ts`. An unmapped code falls to `errors.generic`, which is the English-substring bug this switch replaced. See [Add a string](./add-a-string.md).

## Tests to run

```bash
npx nx test api
npm run docs:generate
npm run test:scripts
npm run test:e2e
npx nx test storefront-types
npx nx test storefront
npx nx e2e storefront-e2e --grep=checkout
```

`npm run docs:generate` rewrites the orders and users pages of the public API reference under `docs/site/reference/`, and `error-codes.md` when a new error code joins them, from the DTOs this recipe edits; commit the regenerated files with the field, or `npm run test:scripts` and the `docs-generate-check` CI job refuse the tree.

- `npx nx test api` runs `apps/api/src/modules/orders/dto/create-order.dto.spec.ts`, which validates `CreateOrderDto` through `plainToInstance` plus `validate`, the place to pin a new field rule.
- `npm run test:e2e` runs `test/e2e/guest-checkout.e2e-spec.ts` against the dockerized test database; it asserts `res.body.error.code` is `ORDER_GUEST_ADDRESS_REQUIRED` for a guest order without an inline address.
- `npx nx test storefront-types` runs `libs/storefront-types/src/lib/users/users.schemas.spec.ts`.
- `npx nx test storefront` runs `address-picker.component.spec.ts`, `address-form.component.spec.ts`, `apps/storefront/src/lib/phone.spec.ts` and `apps/storefront/src/i18n/i18n.spec.ts`, which fails when a `checkout` leaf is missing or empty in any catalogue.
- The journey `apps/storefront-e2e/src/checkout.journey.spec.ts` runs under `describeEveryLocale`, walks the steps, asserts the API answers `ORDER_PAYMENT_METHOD_UNAVAILABLE` when every tender is off, and ends each mutation with `reloadAndAssertClean`.

## Gotchas

- The checkout journey runs `test.describe.configure({ mode: 'serial' })` because one test disables every payment method for its duration, which is global store state. Do not lift it.
- `fixtureShippableAddress()` in `apps/storefront-e2e/src/support/store-config-fixture.ts` returns an address inside the fixture's own country. An address elsewhere matches no shipping zone and every journey behind the delivery step reports `SHIPPING_UNAVAILABLE`.
- Country is upper-cased by a `@Transform` on the saved-address DTO but only matched on the order DTO. A lower-case country on an inline guest address is a 400.
- `guestEmail` is ignored on an authenticated order by design (the DTO comment says why: a signed-in caller must not redirect their own confirmation mail). Do not add fields that let one path override the other.
- `checkout.errors.invalidPostalCode` exists in all three catalogues but nothing renders it: the postal-code control has only `maxLength(20)`. If you add a format rule, wire the message.
- The generic fallback hides new codes. After adding an exception, grep `placeOrderErrorMessageFor` and add the branch, or the customer reads "something went wrong" for a rule you wrote.
- A `fill()` before hydration is lost. The journey waits for `checkout-page` to be visible and drives the step buttons; copy that shape rather than typing into the SSR shell.
