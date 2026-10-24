import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent, SkeletonComponent } from '@admin-ui';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import {
  WebhooksService,
  webhookEventTypeSchema,
  type Webhook,
  type WebhookEventType,
} from '@admin-services';
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

@Component({
  selector: 'app-webhook-edit-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="webhook-edit-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/webhooks" class="hover:underline">Webhooks</a>
        <span aria-hidden="true"> / </span>
        @if (webhook(); as w) {
          <a [routerLink]="['/webhooks', w.id]" class="hover:underline">Detail</a>
          <span aria-hidden="true"> / </span>
        }
        <span [attr.aria-current]="'page'">Edit</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Edit webhook</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Update the URL, event subscriptions, or active status. The signing secret cannot be
          changed here — recreate the subscription if you need to rotate it.
        </p>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="webhook-edit-error"
        [class.border]="!!loadError()"
        [class.border-status-error]="!!loadError()"
        [class.text-ink]="!!loadError()"
        [class.p-3]="!!loadError()"
      >
        {{ loadError() ?? '' }}
      </p>

      @if (loading()) {
        <div class="flex flex-col gap-3" data-testid="webhook-edit-loading">
          <app-skeleton height="2rem" />
          <app-skeleton height="1rem" />
          <app-skeleton height="1rem" />
        </div>
      } @else if (notFound()) {
        <div class="border border-line p-8 text-center" data-testid="webhook-edit-not-found">
          <h1 class="text-2xl font-bold tracking-tight">Webhook not found</h1>
          <p class="mt-3 text-sm text-ink-muted">The subscription was deleted or never existed.</p>
          <a
            routerLink="/webhooks"
            class="mt-6 inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
          >
            Back to webhooks
          </a>
        </div>
      } @else if (webhook(); as w) {
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
              data-testid="webhook-edit-url"
            />
          </app-form-field>

          <fieldset class="flex flex-col gap-3" data-testid="webhook-edit-events-fieldset">
            <legend class="text-sm font-medium text-ink">
              Events <span class="text-status-error" aria-hidden="true">*</span>
            </legend>
            <p class="text-xs text-ink-muted" [id]="eventsHintId">
              Select at least one event type.
            </p>
            <p
              class="text-xs text-status-error"
              [id]="eventsErrorId"
              role="alert"
              aria-atomic="true"
              tabindex="-1"
              data-testid="webhook-edit-events-error"
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
                    [attr.data-testid]="'webhook-edit-event-' + event"
                  />
                  <span class="font-mono tabular-nums">{{ event }}</span>
                </label>
              }
            </div>
          </fieldset>

          <label
            class="flex items-center gap-3 text-sm text-ink min-h-[44px] cursor-pointer"
            data-testid="webhook-edit-active-label"
          >
            <input
              type="checkbox"
              class="h-4 w-4 accent-ink"
              formControlName="isActive"
              data-testid="webhook-edit-active"
            />
            Subscription is active
          </label>

          <div class="flex items-center justify-end gap-3 pt-2">
            <a
              [routerLink]="['/webhooks', w.id]"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
              data-testid="webhook-edit-cancel"
            >
              Cancel
            </a>
            <app-button
              type="submit"
              [disabled]="form.invalid || form.pristine || saving()"
              [loading]="saving()"
              data-testid="webhook-edit-submit"
            >
              Save changes
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class WebhookEditPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly webhooksService = inject(WebhooksService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  readonly urlId = 'webhook-edit-url';
  readonly eventsHintId = 'webhook-edit-events-hint';
  readonly eventsErrorId = 'webhook-edit-events-error';

  readonly eventOptions: readonly WebhookEventType[] = EVENT_TYPES;

  readonly form = this.fb.nonNullable.group({
    url: ['', [Validators.required, Validators.maxLength(2000), httpsUrl]],
    events: this.fb.nonNullable.control<WebhookEventType[]>([]),
    isActive: [true],
  });

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly webhook = signal<Webhook | null>(null);
  readonly saving = signal(false);

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
    this.form.markAsDirty();
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (id) this.fetchWebhook(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    const w = this.webhook();
    if (!w || this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid || this.hasEventsError()) {
      const target = this.form.controls.url.invalid ? this.urlId : this.eventsErrorId;
      queueMicrotask(() => document.getElementById(target)?.focus());
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.loadError.set(null);
    this.webhooksService
      .update(w.id, {
        url: value.url.trim(),
        events: value.events,
        isActive: value.isActive,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          void this.router.navigate(['/webhooks', w.id]);
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
          this.loadError.set(this.formatError(err));
        },
      });
  }

  private fetchWebhook(id: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.loadError.set(null);
    this.webhooksService
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (w) => {
          this.webhook.set(w);
          this.form.patchValue(
            { url: w.url, events: [...w.events], isActive: w.isActive },
            { emitEvent: false },
          );
          this.events.set(w.events);
          this.form.markAsPristine();
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          if (err instanceof ApiNotFoundError) {
            this.notFound.set(true);
            return;
          }
          if (err instanceof ApiError && err.status === 404) {
            this.notFound.set(true);
            return;
          }
          this.loadError.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage webhooks.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load this webhook. Please retry.';
  }
}
