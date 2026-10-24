import type { AbstractControl, ValidationErrors } from '@angular/forms';

/** A Translatable control is valid only when its `default` key has text. */
export function translatableRequired(control: AbstractControl): ValidationErrors | null {
  const value = control.value as { default?: unknown } | null;
  const text = typeof value?.default === 'string' ? value.default.trim() : '';
  return text.length > 0 ? null : { translatableRequired: true };
}
