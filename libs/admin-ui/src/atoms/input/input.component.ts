import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FORM_FIELD_CONTEXT } from '../form-field/form-field.component';

export type InputType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'search'
  | 'date'
  | 'datetime-local';

@Component({
  selector: 'app-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InputComponent), multi: true },
  ],
  template: `
    <!--
      \`flex\`, not a plain block: an <input> is inline-level, so a block wrapper
      would add line-box leading under it and make every form on every screen a
      few pixels taller. A flex container has no line box.
    -->
    <div class="relative flex w-full">
      @if (hasPrefix()) {
        <span
          data-testid="input-prefix"
          aria-hidden="true"
          class="pointer-events-none absolute start-0 inset-y-0 flex items-center ps-3 tabular text-sm uppercase text-ink-muted"
        >
          {{ prefix() }}
        </span>
      }
      <input
        [id]="id()"
        [type]="type()"
        [placeholder]="placeholder() ?? ''"
        [disabled]="isDisabled()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-required]="isRequired() ? 'true' : null"
        [attr.aria-describedby]="effectiveDescribedBy() || null"
        [attr.aria-label]="ariaLabel()"
        [attr.autocomplete]="autocomplete()"
        [attr.inputmode]="inputmode()"
        [attr.step]="step()"
        [attr.min]="min()"
        [value]="value()"
        [class]="rootClass()"
        (input)="handleInput($event)"
        (blur)="handleBlur()"
      />
      @if (hasSuffix()) {
        <span
          data-testid="input-suffix"
          aria-hidden="true"
          class="pointer-events-none absolute end-0 inset-y-0 flex items-center pe-3 tabular text-sm uppercase text-ink-muted"
        >
          {{ suffix() }}
        </span>
      }
    </div>
  `,
})
export class InputComponent implements ControlValueAccessor {
  readonly id = input<string | null>(null);
  readonly type = input<InputType>('text');
  readonly placeholder = input<string | null>(null);
  readonly invalid = input<boolean>(false);
  readonly describedBy = input<string | null>(null);
  /** Forwarded to the native `autocomplete` attribute (password managers). */
  readonly autocomplete = input<string | null>(null);
  /** Forwarded to the native `aria-label` — use when no visual `<label>` applies. */
  readonly ariaLabel = input<string | null>(null);
  /**
   * Forwarded to the native `step` attribute.
   *
   * The atom declared no `step` and its inner input bound none, so every
   * `step="0.01"` written on an `<app-input>` landed as a dead attribute on a
   * custom element and the browser own constraint validation never saw it —
   * the field behaved as `step=1`. Money fields pass the store currency scale.
   */
  readonly step = input<string | number | null>(null);
  /** Forwarded to the native `min` attribute, for the same reason as `step`. */
  readonly min = input<string | number | null>(null);
  /** Forwarded to the native `inputmode` attribute (mobile keyboards). */
  readonly inputmode = input<string | null>(null);
  /**
   * Inline-end adornment naming the unit of the value, e.g. a currency code or
   * `%`. Decoration only: it is `aria-hidden`, so a field carrying one must
   * also name the unit in its label or hint for screen readers.
   */
  readonly suffix = input<string | null>(null);
  /**
   * Inline-start adornment, for a unit written before the value. Same rules as
   * `suffix`: decoration only, `aria-hidden`, so the label or hint still has to
   * name the unit. A store whose money format puts the symbol before the number
   * uses this one and leaves `suffix` unbound.
   */
  readonly prefix = input<string | null>(null);

  private readonly parentField = inject(FORM_FIELD_CONTEXT, { optional: true });

  /** Auto-wires to the parent FormField's errorId/hintId when not explicit. */
  protected readonly effectiveDescribedBy = computed(
    () => this.describedBy() ?? this.parentField?.describedBy() ?? null,
  );

  /**
   * Required-ness comes from the wrapping FormField, which is where a caller
   * declares it. The label's asterisk is aria-hidden, so this attribute is the
   * only thing that tells a screen-reader user the field is mandatory.
   */
  protected readonly isRequired = computed(() => this.parentField?.required() ?? false);

  protected readonly value = signal<string>('');
  protected readonly isDisabled = signal<boolean>(false);

  protected readonly hasSuffix = computed(() => (this.suffix() ?? '').length > 0);
  protected readonly hasPrefix = computed(() => (this.prefix() ?? '').length > 0);

  private onChange: (value: string | number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected rootClass(): string {
    const base =
      'w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed';
    // Extra padding on whichever side carries an adornment, so a long value
    // cannot run under it.
    const withSuffix = this.hasSuffix() ? `${base} pe-14` : base;
    const withAffixes = this.hasPrefix() ? `${withSuffix} ps-14` : withSuffix;
    return this.invalid() ? `${withAffixes} border-status-error` : withAffixes;
  }

  protected handleInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    // Mirrors Angular's own `NumberValueAccessor`: a `type="number"` control
    // reports a real `number | null`, not the native `<input>`'s always-string
    // `.value`. Every money field binds a `FormControl<number | null>` (the
    // request DTOs and the `moneyScaleValidator` both declare a number), and a
    // caller that trusts the generic over the runtime value would build a
    // request body carrying a string a `zod` `z.number()` schema throws on.
    // That throw lands synchronously in a submit handler that already flipped
    // `submitting` to `true`, so the field looked fine, the value round-tripped
    // fine for display, and only a full submit ever surfaced it.
    this.onChange(this.type() === 'number' ? (next === '' ? null : Number(next)) : next);
  }

  protected handleBlur(): void {
    this.onTouched();
  }

  writeValue(value: string | number | null | undefined): void {
    this.value.set(value === null || value === undefined ? '' : String(value));
  }
  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }
}
