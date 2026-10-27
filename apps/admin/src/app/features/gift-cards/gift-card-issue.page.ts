import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { GiftCardsService, type CreateGiftCardRequest } from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  moneyScaleFactor,
} from '@admin-types';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';

/**
 * `/gift-cards/issue` — issue a new gift card.
 *
 * Amount + currency are always required. Recipient email is optional —
 * when present, the backend sends a redemption email. The "send now"
 * toggle is purely a UI affordance here: the backend sends whenever
 * an email is supplied, so unchecking it simply clears `recipientEmail`
 * from the request body.
 *
 * On success we navigate to `/gift-cards/:id` so the user lands on the
 * newly-created card and can copy the code or resend the email.
 */
@Component({
  selector: 'app-gift-card-issue-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-2xl" data-testid="gift-card-issue-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/gift-cards"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Gift cards
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Issue</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">New gift card</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Issue gift card</h1>
        <p class="mt-3 text-sm text-ink-muted">
          The code is generated server-side. You can share it manually once the card is issued, or
          have the backend email the recipient automatically.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="gift-card-issue-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-5" novalidate>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <app-form-field
            label="Amount"
            fieldId="gc-amount"
            [required]="true"
            [hint]="amountHint()"
            [error]="amountError()"
          >
            <app-input
              id="gc-amount"
              type="number"
              [step]="moneyStep()"
              formControlName="initialBalance"
              [invalid]="!!amountError()"
              [prefix]="issuingAffix().prefix"
              [suffix]="issuingAffix().suffix"
            ></app-input>
          </app-form-field>
          <app-form-field
            label="Currency"
            fieldId="gc-currency"
            [required]="true"
            hint="The currencies this store accepts. Manage them under Currencies."
          >
            <select
              id="gc-currency"
              formControlName="currency"
              data-testid="gc-currency-select"
              class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              @if (enabledCurrencies().length === 0) {
                <option value="" disabled>Loading currencies…</option>
              }
              @for (code of enabledCurrencies(); track code) {
                <option [value]="code">{{ code }}</option>
              }
            </select>
          </app-form-field>
        </div>

        <app-form-field label="Expires at" fieldId="gc-expires" hint="Leave empty for no expiry.">
          <app-input id="gc-expires" type="datetime-local" formControlName="expiresAt"></app-input>
        </app-form-field>

        <app-form-field
          label="Recipient email"
          fieldId="gc-email"
          [error]="emailError()"
          hint="Optional — triggers a redemption email when the card is issued."
        >
          <app-input
            id="gc-email"
            type="email"
            formControlName="recipientEmail"
            [invalid]="!!emailError()"
          ></app-input>
        </app-form-field>

        <app-form-field label="Recipient name" fieldId="gc-name">
          <app-input id="gc-name" type="text" formControlName="recipientName"></app-input>
        </app-form-field>

        <label class="inline-flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            formControlName="sendNow"
            class="h-4 w-4 accent-ink"
            data-testid="gc-send-now"
          />
          Send redemption email to recipient now
        </label>

        <footer class="flex items-center justify-end gap-3 pt-4">
          <app-button
            type="button"
            variant="ghost"
            size="sm"
            [disabled]="busy()"
            routerLink="/gift-cards"
            data-testid="gc-cancel"
          >
            Cancel
          </app-button>
          <app-button
            type="submit"
            variant="primary"
            size="md"
            [disabled]="form.invalid || busy()"
            [loading]="busy()"
            data-testid="gc-issue"
          >
            Issue gift card
          </app-button>
        </footer>
      </form>
    </section>
  `,
})
export class GiftCardIssuePage {
  private readonly router = inject(Router);
  private readonly service = inject(GiftCardsService);
  private readonly fb = inject(FormBuilder);

  /**
   * Step the money fields by the store currency's own scale. The atom defaulted
   * to `step=1`, so under a three-decimal currency a legal price could not be
   * typed at all.
   */
  protected readonly moneyStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );

  private readonly currencyStore = inject(CurrencyStore);

  /** Suffix for the money field. Empty while the store currency is unknown. */
  protected readonly storeCode = this.currencyStore.code;
  /** The configured symbol and the side the store writes it on. */
  private readonly moneyAffix = inject(MoneyAffixStore);

  /** The codes this store accepts. Empty while the store currency is unknown. */
  protected readonly enabledCurrencies = this.currencyStore.enabled;

  /**
   * The currency this card is being issued in, which is the one the operator
   * picked on this form and not necessarily the store's own.
   *
   * A plain method, not a `computed`: Reactive-Forms getters are untracked, so
   * a computed over one memoizes its first read and never updates.
   */
  protected issuingCode(): string | null {
    return this.form.controls.currency.value || this.storeCode();
  }

  /**
   * The adornment names the currency the card is issued in.
   *
   * It used to name the store's own, so on a store with more than one enabled
   * currency an operator who changed the dropdown was shown, and told, the
   * wrong one on the field beside it.
   */
  protected issuingAffix(): { prefix: string | null; suffix: string | null } {
    return this.moneyAffix.affixesFor(this.issuingCode());
  }

  /** The adornment is aria-hidden decoration; the hint is what a reader gets. */
  protected amountHint(): string {
    const code = this.issuingCode();
    return code ? `Amount in ${code}.` : '';
  }

  constructor() {
    // Preselect the store currency as soon as hydration lands, unless the
    // operator already picked one.
    effect(() => {
      const code = this.currencyStore.code();
      const control = this.form.controls.currency;
      if (code && !control.value) {
        control.setValue(code);
      }
    });
  }

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    initialBalance: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    // No default. An unhydrated store leaves this empty, which keeps the form
    // invalid instead of confidently issuing a card in the wrong currency.
    currency: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.pattern(/^[A-Z]{3}$/),
    ]),
    expiresAt: this.fb.nonNullable.control(''),
    recipientEmail: this.fb.nonNullable.control('', [Validators.email]),
    recipientName: this.fb.nonNullable.control(''),
    sendNow: this.fb.nonNullable.control(true),
  });

  amountError(): string | null {
    const c = this.form.controls.initialBalance;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Amount is required.';
    if (c.hasError('min')) return 'Amount must be at least 1.';
    return null;
  }

  emailError(): string | null {
    const c = this.form.controls.recipientEmail;
    if (!c.touched || c.valid) return null;
    if (c.hasError('email')) return 'Enter a valid email or leave blank.';
    return null;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;

    const raw = this.form.getRawValue();
    const body: CreateGiftCardRequest = {
      initialBalance: Number(raw.initialBalance),
      currency: raw.currency.toUpperCase(),
      ...(raw.expiresAt ? { expiresAt: new Date(raw.expiresAt).toISOString() } : {}),
      ...(raw.sendNow && raw.recipientEmail ? { recipientEmail: raw.recipientEmail } : {}),
      ...(raw.recipientName ? { recipientName: raw.recipientName } : {}),
    };

    this.busy.set(true);
    this.error.set(null);
    this.service.issue(body).subscribe({
      next: (card) => {
        this.busy.set(false);
        void this.router.navigate(['/gift-cards', card.id]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to issue gift cards.';
    if (err instanceof ApiNotFoundError) return 'Gift card not found.';
    if (err instanceof ApiConflictError) return 'Code conflict — regenerate and retry.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not issue the gift card. Please retry.';
  }
}
