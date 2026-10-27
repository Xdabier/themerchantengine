import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-stepper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StepperComponent),
      multi: true,
    },
  ],
  template: `
    <div class="stepper" role="group" [attr.aria-label]="groupLabel()">
      <button
        type="button"
        class="step decrement"
        [disabled]="!canDecrement()"
        [attr.aria-disabled]="!canDecrement()"
        [attr.aria-label]="decrementLabel()"
        (click)="decrement()"
      >
        −
      </button>
      <span class="value" aria-live="polite">{{ displayed() }}</span>
      <button
        type="button"
        class="step increment"
        [disabled]="!canIncrement()"
        [attr.aria-disabled]="!canIncrement()"
        [attr.aria-label]="incrementLabel()"
        (click)="increment()"
      >
        +
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .stepper {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        border: 1px solid var(--brand-border-strong);
        border-radius: var(--brand-radius-md);
        padding: 0.125rem;
      }
      .step {
        min-inline-size: 44px;
        min-block-size: 44px;
        background: transparent;
        border: none;
        font: inherit;
        font-size: var(--brand-text-product);
        cursor: pointer;
        color: var(--brand-text);
      }
      .step:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .step:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
        border-radius: var(--brand-radius-sm);
      }
      .value {
        min-inline-size: 32px;
        text-align: center;
        font-weight: 600;
      }
    `,
  ],
})
/**
 * Controlled quantity stepper.
 *
 * The displayed number is whatever the owner last passed in, never what the
 * shopper last clicked. The previous version kept an internal signal that a
 * click set permanently, shadowing the input from then on. In the cart that
 * meant a quantity the server refused (`CART_INSUFFICIENT_STOCK`) stayed on
 * screen: the cart re-rendered the old quantity, the input never changed
 * value, and nothing could clear the override short of a page reload.
 *
 * The internal signal survives for the ControlValueAccessor path only, where
 * the form model is the owner and does echo the value back through
 * `writeValue`. It is never written from a click unless the component is
 * actually bound to a form control.
 */
export class StepperComponent implements ControlValueAccessor {
  readonly min = input<number>(1);
  readonly max = input<number>(99);
  readonly value = input<number>(1);
  readonly disabled = input<boolean>(false);
  readonly groupLabel = input<string>('Quantity');
  readonly incrementLabel = input<string>('Increase quantity');
  readonly decrementLabel = input<string>('Decrease quantity');

  readonly valueChange = output<number>();

  private readonly formValue = signal<number | null>(null);
  private readonly formDisabled = signal(false);
  private isFormControl = false;

  protected readonly displayed = computed(() => this.formValue() ?? this.value());
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());

  protected readonly canIncrement = computed(
    () => !this.isDisabled() && this.displayed() < this.max(),
  );
  protected readonly canDecrement = computed(
    () => !this.isDisabled() && this.displayed() > this.min(),
  );

  private onChangeCb: (value: unknown) => void = () => undefined;
  private onTouchedCb: () => void = () => undefined;

  writeValue(value: unknown): void {
    if (typeof value === 'number') this.formValue.set(value);
  }
  registerOnChange(fn: (value: unknown) => void): void {
    this.onChangeCb = fn;
    this.isFormControl = true;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouchedCb = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  protected increment(): void {
    if (!this.canIncrement()) return;
    this.commit(this.displayed() + 1);
  }

  protected decrement(): void {
    if (!this.canDecrement()) return;
    this.commit(this.displayed() - 1);
  }

  private commit(next: number): void {
    // Only a form control echoes the value back, so only that path may move
    // the display ahead of its owner.
    if (this.isFormControl) this.formValue.set(next);
    this.valueChange.emit(next);
    this.onChangeCb(next);
    this.onTouchedCb();
  }
}
