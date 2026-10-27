import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

export type InputType = 'text' | 'email' | 'tel' | 'password' | 'number' | 'search' | 'url';

let nextId = 0;

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
  template: `
    <div class="field" [class.has-error]="!!error()">
      @if (label()) {
        <label [for]="id()" class="label">{{ label() }}</label>
      }
      <div class="control">
        <input
          [id]="id()"
          [type]="type()"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [required]="required()"
          [readonly]="readonly()"
          [autocomplete]="autocomplete()"
          [attr.inputmode]="inputmode()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-label]="!label() && ariaLabel() ? ariaLabel() : null"
          [(ngModel)]="value"
          (blur)="touched()"
        />
      </div>
      @if (helper() && !error()) {
        <p [id]="helperId()" class="helper">{{ helper() }}</p>
      }
      @if (error()) {
        <p [id]="errorId()" class="error" role="alert">{{ error() }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .label {
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text);
      }
      .control {
        position: relative;
      }
      input {
        inline-size: 100%;
        min-block-size: 44px;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        font: inherit;
        color: var(--brand-text);
        background-color: var(--brand-surface);
        /* The resting boundary of a form control takes the interactive border token
           interactif. The decorative border tokens sit under the 3:1 floor
           WCAG 1.4.11 sets for the edge of a UI component. */
        border: 1px solid var(--brand-border-interactive);
        border-radius: var(--brand-radius-md);
        transition: border-color var(--brand-motion-duration) var(--brand-motion-easing);
      }
      input:hover {
        border-color: var(--brand-text-muted);
      }
      input:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 1px;
        border-color: var(--brand-primary);
      }
      input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      @media (prefers-reduced-motion: reduce) {
        input {
          transition: none;
        }
      }
      .has-error input {
        border-color: var(--brand-error);
      }
      .helper {
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .error {
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-error);
      }
    `,
  ],
})
export class InputComponent implements ControlValueAccessor {
  readonly type = input<InputType>('text');
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly helper = input<string>('');
  readonly error = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly required = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly autocomplete = input<string>('off');
  readonly inputmode = input<string | null>(null);
  /**
   * Visually-hidden accessible name used when {@link label} is empty (e.g. an
   * external visible label sits above the field). When both {@link label} and
   * {@link ariaLabel} are set, the visible label wins and aria-label is omitted
   * so AT does not announce the name twice.
   */
  readonly ariaLabel = input<string>('');

  protected readonly id = signal(`app-input-${++nextId}`);
  protected readonly helperId = computed(() => `${this.id()}-helper`);
  protected readonly errorId = computed(() => `${this.id()}-error`);
  protected readonly describedBy = computed(() => {
    if (this.error()) return this.errorId();
    if (this.helper()) return this.helperId();
    return null;
  });

  value: string | number | null = '';

  private onChange: (value: unknown) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: unknown): void {
    this.value = (value as string) ?? '';
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(): void {
    // disabled state is driven by the disabled input signal; the CVA hook
    // is required by Angular but the component intentionally ignores it.
  }

  protected touched(): void {
    this.onTouched();
  }
}
