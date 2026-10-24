import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { ApiError, ApiForbiddenError, ApiValidationError } from '@admin-types';
import { WebhooksService, webhookEventTypeSchema, type WebhookEventType } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';

const EVENT_TYPES = webhookEventTypeSchema.options;

const URL_BACKEND_ERROR_CODES = new Set([
  'WEBHOOK_URL_NOT_HTTPS',
  'WEBHOOK_URL_INTERNAL_IP',
  'INVALID_WEBHOOK_URL',
]);

function httpsUrl(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return /^https:\/\//i.test(value) ? null : { httpsRequired: true };
}

function atLeastOneEvent(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (!Array.isArray(value) || value.length === 0) return { noEvents: true };
  return null;
}

@Component({
  selector: 'app-webhook-create-page',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="webhook-create-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/webhooks" class="hover:underline">Webhooks</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">New</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Create webhook</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Subscribe an HTTPS endpoint to one or more event types. The HMAC secret is shown once on
          success — copy it before leaving this page.
        </p>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="webhook-create-top-error"
        [class.border]="!!topError()"
        [class.border-status-error]="!!topError()"
        [class.text-ink]="!!topError()"
        [class.p-3]="!!topError()"
      >
        {{ topError() ?? '' }}
      </p>

      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        aria-relevant="additions"
        data-testid="webhook-secret-reveal-region"
      >
        @if (revealedSecret(); as secret) {
          <section
            class="border border-status-warning bg-surface p-6 flex flex-col gap-4"
            data-testid="webhook-secret-reveal"
          >
            <header>
              <h2 class="text-lg font-bold tracking-tight">Webhook created</h2>
              <p class="mt-2 text-sm text-ink-muted">
                Copy this signing secret now. It will not be shown again.
              </p>
            </header>
            <pre
              class="font-mono text-xs text-ink p-3 border border-line break-all whitespace-pre-wrap"
              data-testid="webhook-secret-value"
              >{{ secret.secret }}</pre
            >
            <div class="flex items-center justify-end gap-3">
              <app-button
                variant="secondary"
                (clicked)="copySecret(secret.secret)"
                data-testid="webhook-secret-copy"
              >
                {{ copied() ? 'Copied' : 'Copy secret' }}
              </app-button>
              <app-button
                (clicked)="finishReveal(secret.id)"
                data-testid="webhook-secret-done"
                ariaLabel="Continue to webhook detail (the secret will not be shown again)"
              >
                Continue
              </app-button>
            </div>
          </section>
        }
      </div>

      @if (!revealedSecret()) {
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="flex flex-col gap-6 border border-line bg-surface p-6 md:p-8 max-w-3xl"
          novalidate
        >
          <app-form-field
            label="Endpoint URL"
            [fieldId]="urlId"
            [error]="urlError()"
            hint="HTTPS only. The server validates against private/loopback IPs."
            [required]="true"
          >
            <app-input
              [id]="urlId"
              formControlName="url"
              placeholder="https://example.com/webhooks/inbound"
              autocomplete="off"
              [invalid]="!!urlError()"
              data-testid="webhook-url"
            />
          </app-form-field>

          <fieldset class="flex flex-col gap-3" data-testid="webhook-events-fieldset">
            <legend class="text-sm font-medium text-ink">
              Events <span class="text-status-error" aria-hidden="true">*</span>
            </legend>
            <p class="text-xs text-ink-muted" [id]="eventsHintId">
              Select at least one event type. The endpoint will receive a POST per matching event.
            </p>
            <p
              class="text-xs text-status-error"
              [id]="eventsErrorId"
              role="alert"
              aria-atomic="true"
              tabindex="-1"
              data-testid="webhook-events-error"
              [class.sr-only]="!eventsError()"
            >
              {{ eventsError() ?? '' }}
            </p>
            <div
              class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2"
              role="group"
              [attr.aria-describedby]="ariaDescribedBy()"
              [attr.aria-invalid]="eventsError() ? 'true' : null"
            >
              @for (event of eventOptions; track event) {
                <label class="flex items-center gap-3 text-xs text-ink min-h-[44px] cursor-pointer">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-ink"
                    [value]="event"
                    [checked]="isEventSelected(event)"
                    (change)="toggleEvent(event, $any($event.target).checked)"
                    [attr.data-testid]="'webhook-event-' + event"
                  />
                  <span class="font-mono tabular-nums">{{ event }}</span>
                </label>
              }
            </div>
          </fieldset>

          <app-form-field
            label="Custom secret (optional)"
            [fieldId]="secretId"
            [error]="secretFieldError()"
            hint="Leave blank to auto-generate a 64-char hex secret. 16–128 characters."
          >
            <app-input
              [id]="secretId"
              formControlName="secret"
              type="text"
              autocomplete="off"
              [invalid]="!!secretFieldError()"
              data-testid="webhook-secret-input"
            />
          </app-form-field>

          <div class="flex items-center justify-end gap-3 pt-2">
            <a
              routerLink="/webhooks"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
              data-testid="webhook-create-cancel"
            >
              Cancel
            </a>
            <app-button
              type="submit"
              [disabled]="form.invalid || form.pristine || saving()"
              [loading]="saving()"
              data-testid="webhook-create-submit"
            >
              Create webhook
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class WebhookCreatePage implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly webhooks = inject(WebhooksService);
  private readonly destroy$ = new Subject<void>();

  readonly urlId = 'webhook-create-url';
  readonly secretId = 'webhook-create-secret';
  readonly eventsHintId = 'webhook-create-events-hint';
  readonly eventsErrorId = 'webhook-create-events-error';

  readonly eventOptions: readonly WebhookEventType[] = EVENT_TYPES;

  readonly form = this.fb.nonNullable.group({
    url: ['', [Validators.required, Validators.maxLength(2000), httpsUrl]],
    events: this.fb.nonNullable.control<WebhookEventType[]>([], [atLeastOneEvent]),
    secret: new FormControl<string>('', { nonNullable: true }),
  });

  readonly saving = signal(false);
  readonly topError = signal<string | null>(null);
  readonly revealedSecret = signal<{ id: string; secret: string } | null>(null);
  readonly copied = signal(false);

  readonly events = signal<readonly WebhookEventType[]>([]);
  readonly hasEventsError = computed(() => this.events().length === 0);

  ariaDescribedBy(): string {
    return `${this.eventsHintId} ${this.eventsErrorId}`;
  }

  urlError(): string | null {
    const c = this.form.controls.url;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('backend')) return c.getError('backend');
    if (c.hasError('required')) return 'URL is required.';
    if (c.hasError('httpsRequired')) return 'URL must start with https://';
    if (c.hasError('maxlength')) return 'Must be 2000 characters or fewer.';
    return null;
  }

  eventsError(): string | null {
    const c = this.form.controls.events;
    if (!c.touched && !c.dirty) return null;
    if (this.hasEventsError()) return 'Select at least one event.';
    return null;
  }

  secretFieldError(): string | null {
    const value = this.form.controls.secret.value;
    if (!value) return null;
    if (value.length < 16) return 'Must be 16 characters or more.';
    if (value.length > 128) return 'Must be 128 characters or fewer.';
    return null;
  }

  isEventSelected(event: WebhookEventType): boolean {
    return this.events().includes(event);
  }

  toggleEvent(event: WebhookEventType, checked: boolean): void {
    const current = new Set(this.events());
    if (checked) current.add(event);
    else current.delete(event);
    const next = this.eventOptions.filter((e) => current.has(e));
    this.events.set(next);
    this.form.controls.events.setValue(next);
    this.form.controls.events.markAsDirty();
    this.form.controls.events.markAsTouched();
  }

  copySecret(secret: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(secret).then(
        () => this.copied.set(true),
        () => this.copied.set(false),
      );
    }
  }

  finishReveal(id: string): void {
    void this.router.navigate(['/webhooks', id]);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid || this.hasEventsError() || this.secretFieldError()) {
      const target = this.form.controls.url.invalid
        ? this.urlId
        : this.hasEventsError()
          ? this.eventsErrorId
          : this.secretFieldError()
            ? this.secretId
            : null;
      if (target) queueMicrotask(() => document.getElementById(target)?.focus());
      return;
    }
    const value = this.form.getRawValue();
    const secret = value.secret.trim();
    this.saving.set(true);
    this.topError.set(null);
    this.webhooks
      .create({
        url: value.url.trim(),
        events: value.events,
        ...(secret ? { secret } : {}),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (created) => {
          this.saving.set(false);
          this.revealedSecret.set({ id: created.id, secret: created.secret });
        },
        error: (err: unknown) => {
          this.saving.set(false);
          if (err instanceof ApiValidationError && URL_BACKEND_ERROR_CODES.has(err.code)) {
            this.form.controls.url.setErrors({ backend: err.message || 'Invalid webhook URL.' });
            this.form.controls.url.markAsTouched();
            return;
          }
          if (err instanceof ApiError && URL_BACKEND_ERROR_CODES.has(err.code)) {
            this.form.controls.url.setErrors({ backend: err.message || 'Invalid webhook URL.' });
            this.form.controls.url.markAsTouched();
            return;
          }
          this.topError.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to create webhooks.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not create the webhook. Please retry.';
  }
}
