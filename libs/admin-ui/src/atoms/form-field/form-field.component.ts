import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Signal,
  computed,
  forwardRef,
  input,
} from '@angular/core';
import { LabelComponent } from '../label/label.component';

/**
 * Lightweight DI contract consumed by `InputComponent` + `TextareaComponent`
 * so they can auto-wire `aria-describedby` to the parent FormField's
 * generated error/hint ids without the caller duplicating string ids.
 */
export interface FormFieldContext {
  readonly describedBy: Signal<string | null>;
  /**
   * Whether the field is required.
   *
   * Exposed so the projected control can carry `aria-required`. The asterisk
   * the label renders is `aria-hidden`, so without this a screen-reader user
   * is told nothing at all about a field they cannot submit without.
   */
  readonly required: Signal<boolean>;
}

export const FORM_FIELD_CONTEXT = new InjectionToken<FormFieldContext>('FormFieldContext');

/**
 * FormField wrapper: Label + control slot + Error + Hint. Handles ARIA wiring
 * by generating stable ids for the field/error/hint, exposes the resolved
 * `describedBy` via DI so child inputs auto-bind it via
 * `[attr.aria-describedby]` without the consumer repeating ids.
 */
@Component({
  selector: 'app-form-field',
  standalone: true,
  imports: [LabelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FORM_FIELD_CONTEXT, useExisting: forwardRef(() => FormFieldComponent) }],
  template: `
    <div class="flex flex-col gap-2">
      @if (label()) {
        <app-label [for]="fieldId()" [required]="required()">{{ label() }}</app-label>
      }
      <ng-content></ng-content>
      @if (error()) {
        <p
          [id]="errorId()"
          role="alert"
          class="text-xs tabular text-ink border-l-2 border-status-error pl-2 py-0.5"
        >
          {{ error() }}
        </p>
      } @else if (hint()) {
        <p [id]="hintId()" class="text-xs tabular text-ink-muted">{{ hint() }}</p>
      }
    </div>
  `,
})
export class FormFieldComponent {
  readonly label = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly required = input<boolean>(false);
  readonly fieldId = input.required<string>();

  readonly errorId = computed(() => `${this.fieldId()}-error`);
  readonly hintId = computed(() => `${this.fieldId()}-hint`);
  readonly describedBy = computed(() =>
    this.error() ? this.errorId() : this.hint() ? this.hintId() : null,
  );
}
