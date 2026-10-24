---
title: Add a form field
description: "Add a control to an existing admin form: the Zod schema, the Reactive Forms control, the error isolated on the invalid field, the submit button gated on dirty state, the Translatable editor, and the validator tests."
primaryQuery: add a form field angular reactive forms zod admin dashboard
updated: 2026-09-09
schema: HowTo
---

## When you need this

An admin form needs one more input, and the API already accepts the key. You end up with a control in the form group, a schema entry that lets the value through to the request, an error message rendered under that field and nowhere else, a Save button that only lights up once something changed, and a unit test per validator branch. The worked examples are the money settings screen (`/settings/money`) and the carrier form, which carries a `Translatable` name.

## Files you touch

- `libs/admin-services/src/settings/settings.schemas.ts`: the request schema. Zod strips a key it does not model, so a field missing here saves nothing.
- `libs/admin-services/src/settings/settings.schemas.spec.ts`: the schema spec that walks every key and bound. Its `FULL_BODY` constant (lines 23-85, one comment per settings group) gains the new key with a value the DTO accepts.
- `apps/api/src/modules/settings/dto/update-settings.dto.ts`: the API side of the key. The schema spec (lines 119-147) reads this file as source and asserts parity in both directions, so a key the DTO does not declare fails the admin spec as surely as a DTO key the schema lacks. How the DTO gains it is the API recipe [Add a settings key](../api/add-a-settings-key.md).
- `apps/admin/src/app/features/settings/settings.utils.ts`: `readSetting(settings, group, key, fallback)`. Seeding the control needs the group the key belongs to (`money` for the keys on this screen), because the response is grouped.
- `apps/admin/src/app/features/settings/settings-money.page.ts`: the form group, the error methods, the submit gate.
- `apps/admin/src/app/features/settings/settings-money.page.spec.ts`: the validator tests.
- `libs/admin-ui/src/atoms/form-field/form-field.component.ts`: the label, error and hint wrapper that owns the ARIA wiring.
- `libs/admin-ui/src/atoms/input/input.component.ts`: the input atom with `aria-invalid` and `aria-describedby`.
- `libs/admin-ui/src/atoms/translatable-input/translatable-input.component.ts`: the per-locale editor for user-facing text.
- `apps/admin/src/app/features/shipping/carrier-new.page.ts`: a `Translatable` control with its own validator.

## The pattern

### 1. Let the value through the schema

`libs/admin-services/src/settings/settings.schemas.ts` mirrors the API's DTO. The comment above it states the rule the whole recipe hangs on:

```ts
/**
 * It has to model every key the DTO accepts, and it has to model them with the
 * same bounds. Zod strips what it does not know, and `SettingsService.update`
 * throws only when the strip empties the body, so an unmodelled key is a field
 * that saves nothing and reports success. A bound that is looser here than on
 * the DTO is the same defect one layer down: the screen accepts the value and
 * the API answers 400.
 */
export const updateSettingsRequestSchema = z.object({
  symbolPosition: z.enum(STORE_CONFIG_SYMBOL_POSITIONS).optional(),
  decimalSeparator: z.string().length(1).optional(),
  thousandsSeparator: z.string().length(1).optional(),
  vatRate: z
    .number()
    .min(0)
    .max(1)
    .refine((n) => Math.round(n * 1e4) === n * 1e4, 'at most four decimal places')
    .optional(),
```

The bounds are tested one by one in `libs/admin-services/src/settings/settings.schemas.spec.ts`:

```ts
    it('holds vatRate to a rate rather than a percentage', () => {
      expect(() => updateSettingsRequestSchema.parse({ vatRate: 19 })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ vatRate: -0.1 })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ vatRate: 0.123456 })).toThrow();
      expect(updateSettingsRequestSchema.parse({ vatRate: 0.19 })).toEqual({ vatRate: 0.19 });
    });
```

### 2. Declare the control

`apps/admin/src/app/features/settings/settings-money.page.ts` builds a non-nullable group. Angular validators cover the shape; the finer rules live in plain methods (next step).

```ts
  readonly form = this.fb.nonNullable.group({
    symbol: this.fb.nonNullable.control('', [Validators.maxLength(8)]),
    symbolPosition: this.fb.nonNullable.control<string>(STORE_CONFIG_SYMBOL_POSITIONS[0]),
    decimalSeparator: this.fb.nonNullable.control('.', [Validators.maxLength(1)]),
    thousandsSeparator: this.fb.nonNullable.control(',', [Validators.maxLength(1)]),
    decimalPlaces: this.fb.nonNullable.control(2),
    taxDisplay: this.fb.nonNullable.control<string>('none'),
    vatRate: this.fb.nonNullable.control(0),
  });
```

### 3. Isolate the error on the field

The error is a method that reads the control and returns a string or `null`. It stays quiet until the operator has touched the field.

```ts
  vatRateError(): string | null {
    const c = this.form.controls.vatRate;
    if (!c.touched) return null;
    const value = Number(c.value);
    if (Number.isNaN(value) || value < 0 || value > 1) {
      return 'A fraction from 0 to 1, e.g. 0.19 for 19 percent.';
    }
    if (Math.round(value * 1e4) !== value * 1e4) return 'At most four decimal places.';
    return null;
  }
```

The template hands that string to `app-form-field` and flags the input:

```html
<app-form-field
  label="VAT rate"
  fieldId="money-vat-rate"
  [error]="vatRateError()"
  hint="A fraction, not a percentage: 0.19 means 19 percent. Zero means no VAT."
>
  <app-input
    id="money-vat-rate"
    type="number"
    min="0"
    step="0.0001"
    formControlName="vatRate"
    [invalid]="!!vatRateError()"
    data-testid="settings-money-vat-rate"
  ></app-input>
</app-form-field>
```

`libs/admin-ui/src/atoms/form-field/form-field.component.ts` renders the error as `role="alert"` with a generated id and exposes it over DI, so the input inside sets its own `aria-describedby` without the caller repeating ids:

```ts
  readonly errorId = computed(() => `${this.fieldId()}-error`);
  readonly hintId = computed(() => `${this.fieldId()}-hint`);
  readonly describedBy = computed(() =>
    this.error() ? this.errorId() : this.hint() ? this.hintId() : null,
  );
```

### 4. Gate submit on dirty state

The Save button reads `form.dirty` straight from the template, and `save()` refuses a clean form a second time:

```html
<app-button
  type="submit"
  variant="primary"
  [disabled]="form.invalid || busy() || !form.dirty || !canManage()"
  [loading]="busy()"
  data-testid="settings-money-save"
>
  Save
</app-button>
```

```ts
  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;
    if (this.separatorError() || this.decimalPlacesError() || this.vatRateError()) return;

    const raw = this.form.getRawValue();
    const body: UpdateSettingsRequest = {};
    if (this.form.controls.vatRate.dirty) body.vatRate = Number(raw.vatRate);
```

Only dirty controls go into the body, and `seedForm` resets the form with `{ emitEvent: false }` after a load or a save so the button drops back to disabled.

### 5. A user-facing text field is a Translatable

Any text a customer reads is a `{ default, <locale>... }` object. `apps/admin/src/app/features/shipping/carrier-new.page.ts` binds one with `app-translatable-input` and a validator that checks the `default` key:

```ts
function translatableRequired(control: AbstractControl): ValidationErrors | null {
  const value = control.value as TranslatableValue | null;
  if (!value) return { translatableRequired: true };
  const def = typeof value.default === 'string' ? value.default.trim() : '';
  return def.length > 0 ? null : { translatableRequired: true };
}

    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
```

```html
<app-form-field label="Name" [fieldId]="nameId" [error]="nameError()" [required]="true">
  <app-translatable-input
    [inputId]="nameId"
    testId="car-name"
    idPrefix="car-name"
    label="Carrier name"
    formControlName="name"
    [invalid]="!!nameError()"
  />
</app-form-field>
```

The editor's tab list comes from the `TRANSLATABLE_LOCALES` token (`libs/admin-ui/src/atoms/translatable-locales.token.ts`), which `apps/admin/src/app/app.config.ts` feeds from the store's configured locales. Leave `locales` unbound; a locale added under Settings then appears on every editor at once. The first tab is the default locale, and its value is mirrored into `default`.

### 6. The one trap that matters

Reactive Forms are not signals. A `computed()` that reads `this.form.controls.x.value` or `this.form.dirty` runs once, memoizes, and never runs again, because nothing it read is tracked. The money screen records the rule next to the correct pattern:

```ts
  /**
   * A live sample of the format, rebuilt from the form on every change.
   *
   * A signal fed by `valueChanges`, not a computed over the control getters:
   * those are untracked, so a computed memoizes its first read forever.
   */
  private readonly _sample = signal('');
  readonly sample = this._sample.asReadonly();

  ngOnInit(): void {
    this.form.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.renderSample());
```

For derived view state, use one of two shapes: a plain method the template calls on every check (`vatRateError()` above), or a signal you write from `valueChanges`. Never a `computed()` over a form getter.

## Tests to run

```bash
npx nx test admin-services
npx nx test admin
npx nx lint admin
npx nx build admin --configuration=production
npx nx e2e admin-e2e --grep settings-money
```

- `npx nx test admin-services` runs the schema spec, which proves the new key survives the parse, that each bound rejects what the API would reject, and that the DTO declares the same key: the parity test refuses a schema key the DTO lacks, because the API would answer 400 for it under `forbidNonWhitelisted`.
- `npx nx test admin` runs the page spec; write one `it` per validator branch (the money spec has `refuses two separators that are the same character`, `refuses a precision past the storage ceiling`, `refuses a VAT rate entered as a percentage`) plus the axe run.
- `npx nx lint admin` enforces the logical-CSS rule on the template you touched.
- `npx nx build admin --configuration=production` compiles templates strictly; a `formControlName` that the group does not declare fails here and nowhere else.
- `npx nx e2e admin-e2e --grep settings-money` runs the journey in `apps/admin-e2e/src/modules/settings-config.journey.spec.ts`, which saves through the real API, reloads, and restores the previous value in `finally`.

## Gotchas

- A key you add to the form but not to `updateSettingsRequestSchema` is stripped silently. `SettingsService.update` only throws when the strip empties the whole body, so a form that also sends a modelled key reports "saved" for a value that never left the browser.
- `app-input` forwards `step` and `min` to the native input on purpose; an attribute set on a custom element that does not forward it is dead. Check the atom before relying on a native attribute.
- `type="number"` still reports a string from some browsers. The money screen wraps every numeric read in `Number(...)` before comparing or sending.
- The submit gate must include `form.dirty`, or a reload followed by Save writes the loaded values back and bumps `updatedAt` for nothing.
- `translatableSchema` in `libs/admin-types/src/translatable.ts` requires the `default` key. A `Translatable` control seeded with `{}` fails the request parse, and the service surfaces that as an error on the stream, not as a thrown exception.
- `markAllAsTouched()` at the top of `save()` is what makes the error methods speak on a first submit; without it a never-focused invalid field shows no message.
- Never put the Playwright `fill` before hydration in a journey spec. The value lands in the DOM, hydration clears it, and `toBeVisible` cannot tell. Wait on the page's `data-testid` first, as every journey does.
