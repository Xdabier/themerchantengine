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

@Component({
  selector: 'app-textarea',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TextareaComponent), multi: true },
  ],
  template: `
    <textarea
      [id]="id()"
      [rows]="rows()"
      [placeholder]="placeholder() ?? ''"
      [disabled]="isDisabled()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [attr.aria-describedby]="effectiveDescribedBy() || null"
      [attr.aria-label]="ariaLabel()"
      [value]="value()"
      [class]="rootClass()"
      (input)="handleInput($event)"
      (blur)="handleBlur()"
    ></textarea>
  `,
})
export class TextareaComponent implements ControlValueAccessor {
  readonly id = input<string | null>(null);
  readonly rows = input<number>(4);
  readonly placeholder = input<string | null>(null);
  readonly invalid = input<boolean>(false);
  readonly describedBy = input<string | null>(null);
  /** Forwarded to the native `aria-label` — use when no visual `<label>` applies. */
  readonly ariaLabel = input<string | null>(null);

  private readonly parentField = inject(FORM_FIELD_CONTEXT, { optional: true });

  protected readonly effectiveDescribedBy = computed(
    () => this.describedBy() ?? this.parentField?.describedBy() ?? null,
  );

  protected readonly value = signal<string>('');
  protected readonly isDisabled = signal<boolean>(false);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected rootClass(): string {
    const base =
      'w-full px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed resize-y';
    return this.invalid() ? `${base} border-status-error` : base;
  }

  protected handleInput(event: Event): void {
    const next = (event.target as HTMLTextAreaElement).value;
    this.value.set(next);
    this.onChange(next);
  }

  protected handleBlur(): void {
    this.onTouched();
  }

  writeValue(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }
}
