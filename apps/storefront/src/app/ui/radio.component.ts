import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

export interface RadioOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-radio-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RadioGroupComponent),
      multi: true,
    },
  ],
  template: `
    <fieldset class="group" [attr.aria-labelledby]="legend() ? legendId() : null">
      @if (legend()) {
        <legend [id]="legendId()" class="legend">{{ legend() }}</legend>
      }
      <div class="options">
        @for (opt of options(); track opt.value) {
          <label class="row" [class.disabled]="opt.disabled">
            <input
              type="radio"
              [name]="name()"
              [value]="opt.value"
              [checked]="opt.value === current()"
              [disabled]="!!opt.disabled || disabled()"
              (change)="select(opt.value)"
              (blur)="touched()"
            />
            <span>{{ opt.label }}</span>
          </label>
        }
      </div>
    </fieldset>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .group {
        border: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .legend {
        padding: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text);
      }
      .options {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .row {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        cursor: pointer;
        min-block-size: 44px;
        padding-block: 0.25rem;
      }
      .row.disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      input {
        inline-size: 20px;
        block-size: 20px;
        accent-color: var(--brand-primary);
        margin: 0;
      }
      input:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
    `,
  ],
})
export class RadioGroupComponent implements ControlValueAccessor {
  readonly options = input<RadioOption[]>([]);
  /**
   * Visible legend for the fieldset. Strongly recommended — leaving this
   * empty produces a `<fieldset>` with no accessible name, which axe flags
   * as a `group-label` serious violation when the group contains radios.
   */
  readonly legend = input<string>('');
  readonly disabled = input<boolean>(false);

  private readonly _name = signal(`app-radio-${++nextId}`);
  protected readonly name = computed(() => this._name());
  protected readonly legendId = computed(() => `${this._name()}-legend`);

  private readonly _value = signal<string | null>(null);
  protected readonly current = computed(() => this._value());

  private onChangeCb: (value: unknown) => void = () => undefined;
  private onTouchedCb: () => void = () => undefined;

  writeValue(value: unknown): void {
    this._value.set((value as string) ?? null);
  }
  registerOnChange(fn: (value: unknown) => void): void {
    this.onChangeCb = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouchedCb = fn;
  }
  setDisabledState(): void {
    return;
  }

  protected select(value: string): void {
    this._value.set(value);
    this.onChangeCb(value);
  }

  protected touched(): void {
    this.onTouchedCb();
  }
}
