import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  forwardRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

@Component({
  selector: 'app-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CheckboxComponent),
      multi: true,
    },
  ],
  template: `
    <label class="row" [for]="id()">
      <input
        #input
        type="checkbox"
        [id]="id()"
        [checked]="checked()"
        [disabled]="disabled()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        (change)="onChange($event)"
        (blur)="onTouched()"
      />
      <span class="label"><ng-content /></span>
    </label>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .row {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        cursor: pointer;
        min-block-size: 44px;
        padding-block: 0.25rem;
      }
      .row:has(input:disabled) {
        cursor: not-allowed;
        opacity: 0.55;
      }
      input {
        inline-size: 20px;
        block-size: 20px;
        accent-color: var(--brand-primary);
        margin: 0;
        cursor: inherit;
      }
      input:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .label {
        font-size: var(--brand-text-body);
        color: var(--brand-text);
      }
    `,
  ],
})
export class CheckboxComponent implements ControlValueAccessor, AfterViewInit {
  readonly checked = input<boolean>(false);
  readonly indeterminate = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly invalid = input<boolean>(false);

  protected readonly id = signal(`app-checkbox-${++nextId}`);
  protected readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('input');

  private onChangeCb: (value: unknown) => void = () => undefined;
  private onTouchedCb: () => void = () => undefined;

  constructor() {
    effect(() => {
      const el = this.inputEl()?.nativeElement;
      if (el) el.indeterminate = this.indeterminate();
    });
  }

  ngAfterViewInit(): void {
    const el = this.inputEl()?.nativeElement;
    if (el) el.indeterminate = this.indeterminate();
  }

  writeValue(value: unknown): void {
    const el = this.inputEl()?.nativeElement;
    if (el) el.checked = !!value;
  }
  registerOnChange(fn: (value: unknown) => void): void {
    this.onChangeCb = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouchedCb = fn;
  }
  setDisabledState(): void {
    // disabled state is driven by the disabled() signal input.
    return;
  }

  protected onChange(event: Event): void {
    const next = (event.target as HTMLInputElement).checked;
    this.onChangeCb(next);
  }

  protected onTouched(): void {
    this.onTouchedCb();
  }
}
