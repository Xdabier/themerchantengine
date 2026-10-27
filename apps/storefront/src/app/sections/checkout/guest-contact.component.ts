import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  inject,
  input,
  Output,
  effect,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { LocaleService } from '../../locale.service';

/** What a guest order carries in place of an account. */
export interface GuestContact {
  email: string;
  company?: string;
  note?: string;
}

/** The same shape the API's `@IsEmail` accepts, kept deliberately permissive. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Contact details for a checkout with no account (findings K3, D1).
 *
 * `requiredFields` is one of the five checkout settings that had no storefront
 * consumer at all: the admin round-tripped the operator's choices into a void.
 * This is where the operator-facing half of that setting lands, and the mapping
 * is deliberate:
 *
 * - `email` is collected and required whatever the setting says. The order
 *   confirmation and the track-by-email challenge both key off it, so a guest
 *   order without one is unreachable by the person who placed it.
 * - `phone` is already structurally required by the delivery-address form, so
 *   listing it adds no field here.
 * - `company` and `note` render only when listed, and are required when they
 *   do: listed means the operator wants it.
 * - `shippingAddress` is always collected, so listing it changes nothing.
 * - `billingAddress` has no separate surface on this storefront, so listing it
 *   changes nothing today. Recorded rather than silently ignored.
 *
 * `contactChanged` emits null while the form is incomplete, so the page gates
 * the step on a real value rather than re-deriving validity.
 */
@Component({
  selector: 'app-guest-contact',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="group" [formGroup]="form">
      <legend class="legend">{{ strings().checkout.guest.title }}</legend>
      <p class="intro">{{ strings().checkout.guest.intro }}</p>

      <label class="field">
        <span class="label">{{ strings().checkout.guest.email }}</span>
        <input
          type="email"
          formControlName="email"
          autocomplete="email"
          [attr.aria-describedby]="emailHintId"
          [attr.aria-invalid]="showError('email') ? 'true' : null"
          data-testid="guest-email"
        />
        <span class="hint" [id]="emailHintId">{{ strings().checkout.guest.emailHint }}</span>
        @if (showError('email')) {
          <span class="error" role="alert" data-testid="guest-email-error">
            {{ strings().checkout.errors.invalidEmail }}
          </span>
        }
      </label>

      @if (wants('company')) {
        <label class="field">
          <span class="label">{{ strings().checkout.guest.company }}</span>
          <input
            type="text"
            formControlName="company"
            autocomplete="organization"
            [attr.aria-invalid]="showError('company') ? 'true' : null"
            data-testid="guest-company"
          />
          @if (showError('company')) {
            <span class="error" role="alert">{{ strings().checkout.errors.requiredField }}</span>
          }
        </label>
      }

      @if (wants('note')) {
        <label class="field">
          <span class="label">{{ strings().checkout.guest.note }}</span>
          <textarea
            formControlName="note"
            rows="3"
            [attr.aria-invalid]="showError('note') ? 'true' : null"
            data-testid="guest-note"
          ></textarea>
          @if (showError('note')) {
            <span class="error" role="alert">{{ strings().checkout.errors.requiredField }}</span>
          }
        </label>
      }
    </fieldset>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .group {
        margin: 0 0 1.5rem;
        padding: 0;
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .legend {
        padding: 0;
        color: var(--brand-text);
        font-weight: 600;
        font-size: var(--brand-text-body);
      }
      .intro {
        margin: 0;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .label {
        color: var(--brand-text);
        font-size: var(--brand-text-micro);
      }
      input,
      textarea {
        padding-inline: 0.75rem;
        padding-block: 0.5rem;
        border: 1px solid var(--brand-border);
        background-color: var(--brand-surface);
        color: var(--brand-text);
        font: inherit;
      }
      input:focus-visible,
      textarea:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .hint {
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      .error {
        color: var(--brand-error);
        font-size: var(--brand-text-micro);
      }
    `,
  ],
})
export class GuestContactComponent {
  readonly requiredFields = input<string[]>([]);

  @Output() readonly contactChanged = new EventEmitter<GuestContact | null>();

  private readonly fb = inject(FormBuilder);
  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;

  private static nextId = 0;
  protected readonly emailHintId = `guest-email-hint-${GuestContactComponent.nextId++}`;

  protected readonly form: FormGroup = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_RE)]],
    company: [''],
    note: [''],
  });

  /**
   * Mirrors the form's validity into the signal graph.
   *
   * Reading a Reactive-Forms getter inside a `computed()` memoizes on a value
   * the graph never sees change, which is the zoneless freeze this codebase has
   * hit before. A counter bumped from `valueChanges` is the pattern that works.
   */
  private readonly formVersion = signal(0);

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      this.formVersion.update((v) => v + 1);
      this.contactChanged.emit(this.snapshot());
    });
    // Listed means required, so the validators follow the operator's setting
    // rather than being baked in at build time.
    effect(() => {
      const listed = this.requiredFields();
      for (const key of ['company', 'note'] as const) {
        const control = this.form.get(key);
        if (!control) continue;
        control.setValidators(listed.includes(key) ? [Validators.required] : []);
        control.updateValueAndValidity({ emitEvent: false });
      }
      this.contactChanged.emit(this.snapshot());
    });
  }

  protected wants(field: 'company' | 'note'): boolean {
    return this.requiredFields().includes(field);
  }

  /** A plain method, never a `computed()` over a form getter. */
  protected showError(key: string): boolean {
    this.formVersion();
    const control = this.form.get(key);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  private snapshot(): GuestContact | null {
    if (this.form.invalid) return null;
    const raw = this.form.getRawValue() as { email: string; company: string; note: string };
    const email = raw.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    return {
      email,
      ...(this.wants('company') && raw.company.trim() ? { company: raw.company.trim() } : {}),
      ...(this.wants('note') && raw.note.trim() ? { note: raw.note.trim() } : {}),
    };
  }

  /** Marks every control touched so the page can surface errors on submit. */
  markTouched(): void {
    this.form.markAllAsTouched();
    this.formVersion.update((v) => v + 1);
  }
}
