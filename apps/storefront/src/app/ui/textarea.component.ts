import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

@Component({
  selector: 'app-textarea',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TextareaComponent),
      multi: true,
    },
  ],
  template: `
    <div class="field" [class.has-error]="!!error()">
      @if (label()) {
        <label [for]="id()" class="label">{{ label() }}</label>
      }
      <textarea
        [id]="id()"
        [rows]="rows()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [required]="required()"
        [readonly]="readonly()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-label]="!label() && ariaLabel() ? ariaLabel() : null"
        [(ngModel)]="value"
        (blur)="touched()"
      ></textarea>
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
      textarea {
        inline-size: 100%;
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
        resize: vertical;
        min-block-size: 88px;
      }
      textarea:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 1px;
        border-color: var(--brand-primary);
      }
      textarea:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .has-error textarea {
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
export class TextareaComponent implements ControlValueAccessor {
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly helper = input<string>('');
  readonly error = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly required = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly rows = input<number>(4);
  readonly ariaLabel = input<string>('');

  protected readonly id = signal(`app-textarea-${++nextId}`);
  protected readonly helperId = computed(() => `${this.id()}-helper`);
  protected readonly errorId = computed(() => `${this.id()}-error`);
  protected readonly describedBy = computed(() => {
    if (this.error()) return this.errorId();
    if (this.helper()) return this.helperId();
    return null;
  });

  value: string = '';

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
    return;
  }

  protected touched(): void {
    this.onTouched();
  }
}
