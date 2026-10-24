import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
  openConfirmDialog,
  type TranslatableValue,
} from '@admin-ui';
import {
  NotificationTemplatesService,
  type CreateTemplateRequest,
  type NotificationTemplate,
  type PreviewTemplateResponse,
  type TemplateChannel,
  type UpdateTemplateRequest,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { TRANSLATABLE_LOCALES, localeTabCodes } from '@admin-ui/atoms/translatable-locales.token';
import { localeLabel } from '../../shared/format/locale';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

const CODE_PATTERN = /^[a-z][a-z0-9_.]*$/;

function templateDisplay(
  t: Pick<NotificationTemplate, 'subject' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    t.subject as Translatable | string | null | undefined,
    locale,
    t.code,
    defaultLocale,
  );
}

/**
 * Coerce a stored Translatable into the editor's form value. Seeded templates
 * store locale-keyed bodies WITHOUT a `default` key, so the previous
 * `'default' in v` guard discarded the content and loaded an empty subject —
 * the editor showed a blank subject + the live preview rendered empty (server
 * `pickLocale` does not fall back to `default`). Preserve any object's locale
 * keys; only fall back to a blank Translatable for non-objects. Mirrors the
 * campaign editor. See the Translatable schema-drift class.
 */
export function asTranslatable(v: unknown): TranslatableValue {
  if (v && typeof v === 'object') return v as TranslatableValue;
  return { default: '' };
}

/** Same identifier grammar as the backend interpolator + token validator. */
function extractTokens(text: string): string[] {
  const out: string[] = [];
  const re = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function translatableTokens(v: TranslatableValue | null | undefined): string[] {
  if (!v || typeof v !== 'object') return [];
  return Object.values(v).flatMap((s) => (typeof s === 'string' ? extractTokens(s) : []));
}

/**
 * `/notifications/templates/new` + `/notifications/templates/:id` — compose
 * or edit a template. Subject is required for email only; SMS/push drop it.
 * Body is always a Translatable textarea.
 */
@Component({
  selector: 'app-template-editor-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="template-editor-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/notifications/templates"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Templates
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">
          {{ isNew() ? 'New template' : current() ? display(current()!) : '…' }}
        </span>
      </nav>

      <div role="alert" data-testid="template-editor-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="3rem" width="40%" />
          <app-skeleton height="14rem" width="100%" />
        </div>
      } @else if (!isNew() && !current()) {
        <p class="tabular text-sm text-ink-muted">Template not found.</p>
      } @else {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">
              {{ channelDisplay() }}
            </p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ isNew() ? 'New template' : current() ? display(current()!) : '…' }}
            </h1>
            @if (!isNew() && current()) {
              <p class="mt-3 tabular text-sm text-ink-muted">
                Code
                <code class="font-mono text-ink">{{ current()!.code }}</code>
              </p>
            }
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            @if (!isNew() && current()) {
              <app-badge
                [tone]="current()!.isEnabled ? 'success' : 'neutral'"
                [ariaLabel]="current()!.isEnabled ? 'Enabled' : 'Disabled'"
              >
                {{ current()!.isEnabled ? 'Enabled' : 'Disabled' }}
              </app-badge>
            }
            <span role="status" aria-live="polite" class="inline-flex">
              @if (saved()) {
                <app-badge tone="success" [ariaLabel]="'Changes saved'">Saved</app-badge>
              }
            </span>
          </div>
        </header>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          @if (isNew()) {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <app-form-field
                label="Code"
                fieldId="tmpl-code"
                [required]="true"
                [error]="codeError()"
                hint="Lowercase, dot- or underscore-separated (e.g. order.shipped)."
              >
                <app-input
                  id="tmpl-code"
                  type="text"
                  autocomplete="off"
                  formControlName="code"
                  [invalid]="!!codeError()"
                ></app-input>
              </app-form-field>

              <app-form-field label="Channel" fieldId="tmpl-channel" [required]="true">
                <select
                  id="tmpl-channel"
                  formControlName="channel"
                  class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  data-testid="tmpl-channel"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="push">Push</option>
                </select>
              </app-form-field>
            </div>

            <app-form-field
              label="Event"
              fieldId="tmpl-event"
              [required]="true"
              [error]="eventError()"
              hint="Domain event that fires this template (e.g. order.shipped)."
            >
              <app-input
                id="tmpl-event"
                type="text"
                autocomplete="off"
                formControlName="event"
                [invalid]="!!eventError()"
              ></app-input>
            </app-form-field>
          }

          @if (isEmail()) {
            <app-form-field label="Subject" fieldId="tmpl-subject" [required]="true">
              <app-translatable-input
                formControlName="subject"
                label="Subject"
                inputId="tmpl-subject"
                idPrefix="tmpl-subject"
                testId="tmpl-subject"
              ></app-translatable-input>
            </app-form-field>
          }

          <app-form-field label="Body" fieldId="tmpl-body" [required]="true">
            <app-translatable-input
              formControlName="body"
              label="Body"
              [multiline]="true"
              inputId="tmpl-body"
              idPrefix="tmpl-body"
              testId="tmpl-body"
            ></app-translatable-input>
          </app-form-field>

          <app-form-field
            label="Variables"
            fieldId="tmpl-variables"
            hint="Comma-separated placeholder names available inside subject + body (e.g. customerName, orderNumber)."
          >
            <app-input
              id="tmpl-variables"
              type="text"
              autocomplete="off"
              formControlName="variables"
            ></app-input>
          </app-form-field>

          @if (unknownTokens().length > 0) {
            <div
              role="alert"
              class="border border-status-warning text-ink p-3 tabular text-xs"
              data-testid="tmpl-token-warning"
            >
              Undeclared {{ unknownTokens().length === 1 ? 'variable' : 'variables' }} in the
              subject/body: <span class="font-mono">{{ unknownTokens().join(', ') }}</span
              >. Add each to the Variables list or remove the token before saving.
            </div>
          }

          <label class="inline-flex items-center gap-3 text-sm tabular">
            <input
              type="checkbox"
              formControlName="isEnabled"
              class="h-4 w-4 accent-ink"
              data-testid="tmpl-enabled"
            />
            Enabled — fires on the configured event.
          </label>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <div class="flex items-center gap-3">
              @if (!isNew() && canDelete()) {
                <app-button
                  type="button"
                  variant="destructive"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'delete'"
                  (clicked)="confirmDelete()"
                  data-testid="tmpl-delete"
                >
                  Delete template
                </app-button>
              }
              <p class="text-xs tabular text-ink-muted">
                {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                routerLink="/notifications/templates"
                data-testid="tmpl-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="
                  form.invalid || busy() || unknownTokens().length > 0 || (!isNew() && !form.dirty)
                "
                [loading]="busy() && action() === 'save'"
                data-testid="tmpl-save"
              >
                {{ isNew() ? 'Create template' : 'Save changes' }}
              </app-button>
            </div>
          </footer>
        </form>

        @if (!isNew() && current()) {
          <section
            class="border-t border-line pt-8 flex flex-col gap-5 max-w-3xl"
            data-testid="tmpl-preview-section"
          >
            <div class="flex items-end justify-between gap-4 flex-wrap">
              <div class="min-w-0">
                <h2 class="text-xs tracking-widest uppercase text-ink-muted">Preview &amp; test</h2>
                <p class="mt-2 text-sm text-ink-muted max-w-xl">
                  Renders the current draft with sample values. "Send test" delivers the saved
                  template to your own inbox — save first to test your latest edits.
                </p>
              </div>
              <div class="flex items-center gap-2" role="group" aria-label="Preview locale">
                @for (loc of previewLocales(); track loc) {
                  <button
                    type="button"
                    class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                    [class.border-ink]="previewLocale() === loc"
                    [class.text-ink]="previewLocale() === loc"
                    [class.border-line]="previewLocale() !== loc"
                    [class.text-ink-muted]="previewLocale() !== loc"
                    [attr.aria-pressed]="previewLocale() === loc"
                    [attr.data-testid]="'tmpl-preview-locale-' + loc"
                    (click)="setPreviewLocale(loc)"
                  >
                    {{ localeLabel(loc) }}
                  </button>
                }
              </div>
            </div>

            <div class="flex items-center gap-3 flex-wrap">
              <app-button
                type="button"
                variant="secondary"
                size="sm"
                [loading]="previewBusy()"
                [disabled]="previewBusy()"
                (clicked)="runPreview()"
                data-testid="tmpl-preview-run"
              >
                Refresh preview
              </app-button>
              @if (canManage()) {
                <app-button
                  type="button"
                  variant="secondary"
                  size="sm"
                  [loading]="testBusy()"
                  [disabled]="testBusy()"
                  (clicked)="sendTest()"
                  data-testid="tmpl-send-test"
                >
                  Send test to me
                </app-button>
              }
            </div>

            <div role="alert" data-testid="tmpl-preview-error">
              @if (previewError()) {
                <p class="border border-status-error text-ink p-3 tabular text-xs">
                  {{ previewError() }}
                </p>
              }
            </div>
            <div role="status" aria-live="polite" data-testid="tmpl-test-notice">
              @if (testNotice()) {
                <p class="border border-status-success text-ink p-3 tabular text-xs">
                  {{ testNotice() }}
                </p>
              }
            </div>

            @if (previewResult()) {
              <div class="flex flex-col gap-2">
                <p class="text-xs tracking-widest uppercase text-ink-muted">Subject</p>
                <p class="tabular text-sm text-ink" data-testid="tmpl-preview-subject">
                  {{ activePreview()?.subject }}
                </p>
              </div>
              <p class="sr-only">
                The subject line above shows the rendered text. The email body below is a visual
                preview only.
              </p>
              <div class="border border-line bg-preview-ground">
                <iframe
                  #previewFrame
                  title="Email preview"
                  aria-hidden="true"
                  class="w-full h-[28rem]"
                  sandbox=""
                  data-testid="tmpl-preview-frame"
                ></iframe>
              </div>
            }
          </section>
        }
      }
    </section>
  `,
})
export class TemplateEditorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(NotificationTemplatesService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly storeLocales = inject(TRANSLATABLE_LOCALES);
  private readonly destroy$ = new Subject<void>();

  protected readonly display = (t: Pick<NotificationTemplate, 'subject' | 'code'>): string =>
    templateDisplay(t, this.authStore.locale(), this.storeSettings.defaultLocale());

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<NotificationTemplate | null>(null);
  readonly isNew = signal(false);
  readonly busy = signal(false);
  readonly action = signal<'save' | 'delete' | null>(null);
  readonly saved = signal(false);

  // NE6 preview + test-send + token validation.
  /**
   * The locale tabs the preview offers: the keys the response actually carries,
   * falling back to the store's locales before a preview has run.
   *
   * Those two agree since D7 moved the mail renderer onto the store locale
   * pair. Until then they could not: the renderer emitted a fixed pair of its
   * own and a store-locale tab would have shown an empty preview, which is why
   * a bridge constant stood here. It is deleted with the mismatch it described.
   */
  protected readonly previewLocales = computed<readonly string[]>(() => {
    const keys = Object.keys(this.previewResult() ?? {});
    return keys.length > 0 ? keys : localeTabCodes(this.storeLocales());
  });
  protected readonly localeLabel = localeLabel;
  readonly previewResult = signal<PreviewTemplateResponse | null>(null);
  private readonly previewLocaleOverride = signal<string | null>(null);

  /** The selected preview locale, clamped to the tabs actually rendered. */
  readonly previewLocale = computed<string>(() => {
    const locales = this.previewLocales();
    const chosen = this.previewLocaleOverride();
    if (chosen && locales.includes(chosen)) return chosen;
    return locales[0] ?? '';
  });
  readonly previewBusy = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly testBusy = signal(false);
  readonly testNotice = signal<string | null>(null);
  readonly unknownTokens = signal<readonly string[]>([]);
  private readonly previewFrame = viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

  readonly activePreview = computed(() => {
    const r = this.previewResult();
    return r ? (r[this.previewLocale()] ?? null) : null;
  });

  readonly canDelete = computed(() => this.authStore.hasAnyPermission(['notifications:manage']));
  readonly canManage = computed(() => this.authStore.hasAnyPermission(['notifications:manage']));

  constructor() {
    // Write the server-rendered, server-sanitized email into a fully sandboxed
    // iframe (no scripts, no same-origin) via the DOM property — no
    // bypassSecurityTrust, no Angular sanitizer mangling the inline-CSS layout.
    effect(() => {
      const html = this.activePreview()?.html ?? '';
      const frame = this.previewFrame();
      if (frame) frame.nativeElement.srcdoc = html;
    });
  }

  readonly form = this.fb.nonNullable.group({
    code: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(CODE_PATTERN)]),
    channel: this.fb.nonNullable.control<TemplateChannel>('email'),
    event: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(CODE_PATTERN)]),
    subject: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    body: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [Validators.required]),
    variables: this.fb.nonNullable.control(''),
    isEnabled: this.fb.nonNullable.control(true),
  });

  // Plain methods, not computed(): the channel control's value getter reads its
  // backing signal through untracked(), so a computed() over it freezes at its
  // initial value under zoneless CD — the Subject field (gated by isEmail) would
  // not toggle when the channel select changes. A method re-evaluates each CD pass.
  isEmail(): boolean {
    return this.form.controls.channel.value === 'email';
  }

  channelDisplay(): string {
    const c = this.current()?.channel ?? this.form.controls.channel.value;
    switch (c) {
      case 'email':
        return 'Email';
      case 'sms':
        return 'SMS';
      case 'push':
        return 'Push';
      default:
        return '';
    }
  }

  codeError(): string | null {
    const c = this.form.controls.code;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Code is required.';
    if (c.hasError('pattern'))
      return 'Use lowercase, dots or underscores only (e.g. order.shipped).';
    return null;
  }

  eventError(): string | null {
    const c = this.form.controls.event;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Event is required.';
    if (c.hasError('pattern')) return 'Use lowercase, dots or underscores only.';
    return null;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get('id');
      if (!id || id === 'new') {
        this.isNew.set(true);
        this.loading.set(false);
        return;
      }
      this.isNew.set(false);
      this.fetch(id);
    });

    this.form.controls.channel.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((channel) => {
      const subject = this.form.controls.subject;
      if (channel === 'email') {
        subject.enable({ emitEvent: false });
      } else {
        subject.setValue({ default: '' }, { emitEvent: false });
        subject.disable({ emitEvent: false });
      }
    });

    // Live variable-token validation: a {{token}} in subject/body must be
    // declared in Variables, mirroring the backend save-time guard (Risk R12).
    this.form.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.recomputeTokens());
    this.recomputeTokens();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    if (this.unknownTokens().length > 0) return;
    if (!this.isNew() && !this.form.dirty) return;

    const raw = this.form.getRawValue();
    const variables = raw.variables
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);

    if (this.isNew()) {
      const body: CreateTemplateRequest = {
        code: raw.code,
        channel: raw.channel,
        event: raw.event,
        body: raw.body,
        ...(raw.channel === 'email' ? { subject: raw.subject } : {}),
        ...(variables.length > 0 ? { variables } : {}),
        isEnabled: raw.isEnabled,
      };

      this.busy.set(true);
      this.action.set('save');
      this.error.set(null);
      this.service.createTemplate(body).subscribe({
        next: (t) => {
          this.busy.set(false);
          this.action.set(null);
          void this.router.navigate(['/notifications/templates', t.id]);
        },
        error: (err: unknown) => this.failAction(err, 'Could not create template.'),
      });
      return;
    }

    const controls = this.form.controls;
    const body: UpdateTemplateRequest = {};
    if (this.isEmail() && controls.subject.dirty) body.subject = raw.subject;
    if (controls.body.dirty) body.body = raw.body;
    if (controls.variables.dirty) body.variables = variables;
    if (controls.isEnabled.dirty) body.isEnabled = raw.isEnabled;

    this.busy.set(true);
    this.action.set('save');
    this.error.set(null);
    this.service.updateTemplate(this.current()!.id, body).subscribe({
      next: (t) => {
        this.current.set(t);
        this.seedForm(t);
        this.busy.set(false);
        this.action.set(null);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => this.failAction(err, 'Could not save template.'),
    });
  }

  async confirmDelete(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this template?',
      body: `"${templateDisplay(current, this.authStore.locale(), this.storeSettings.defaultLocale())}" will stop firing. This cannot be undone — the record is removed permanently.`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;

    this.busy.set(true);
    this.action.set('delete');
    this.error.set(null);
    this.service.deleteTemplate(current.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        void this.router.navigate(['/notifications/templates']);
      },
      error: (err: unknown) => this.failAction(err, 'Could not delete template.'),
    });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getTemplate(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (t) => {
          this.current.set(t);
          this.seedForm(t);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(t: NotificationTemplate): void {
    this.form.reset(
      {
        code: t.code,
        channel: t.channel,
        event: t.event,
        subject: asTranslatable(t.subject),
        body: asTranslatable(t.body),
        variables: (t.variables ?? []).join(', '),
        isEnabled: t.isEnabled,
      },
      { emitEvent: false },
    );
    // Existing records can't change code/channel/event via PATCH — lock them.
    this.form.controls.code.disable({ emitEvent: false });
    this.form.controls.channel.disable({ emitEvent: false });
    this.form.controls.event.disable({ emitEvent: false });
    if (t.channel !== 'email') this.form.controls.subject.disable({ emitEvent: false });
    // reset() with emitEvent:false won't fire valueChanges — recompute by hand.
    this.recomputeTokens();
  }

  setPreviewLocale(locale: string): void {
    this.previewLocaleOverride.set(locale);
  }

  /** Render the current draft (both locales) server-side; nothing is persisted. */
  runPreview(): void {
    const cur = this.current();
    if (!cur || this.previewBusy()) return;
    const raw = this.form.getRawValue();
    const variables = this.parseVariables(raw.variables);
    this.previewBusy.set(true);
    this.previewError.set(null);
    this.service
      .preview(cur.id, {
        ...(this.isEmail() ? { subject: raw.subject } : {}),
        body: raw.body,
        variables,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.previewResult.set(res);
          this.previewBusy.set(false);
        },
        error: (err: unknown) => {
          this.previewBusy.set(false);
          this.previewError.set(this.formatPreviewError(err, 'Could not render the preview.'));
        },
      });
  }

  /** Send the saved template to the operator's own inbox in the active locale. */
  sendTest(): void {
    const cur = this.current();
    if (!cur || this.testBusy()) return;
    this.testBusy.set(true);
    this.testNotice.set(null);
    this.previewError.set(null);
    this.service
      .sendTest(cur.id, { locale: this.previewLocale() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.testBusy.set(false);
          this.testNotice.set(
            res.status === 'queued'
              ? `Queued a test to ${res.recipient}.`
              : res.status === 'skipped'
                ? 'This flow is currently off — turn it on to send a test.'
                : `${res.recipient} is suppressed; no test was sent.`,
          );
          setTimeout(() => this.testNotice.set(null), 4000);
        },
        error: (err: unknown) => {
          this.testBusy.set(false);
          this.previewError.set(this.formatPreviewError(err, 'Could not send the test.'));
        },
      });
  }

  private parseVariables(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  private recomputeTokens(): void {
    const raw = this.form.getRawValue();
    const declared = new Set(this.parseVariables(raw.variables));
    const used = [...translatableTokens(raw.subject), ...translatableTokens(raw.body)];
    this.unknownTokens.set([...new Set(used.filter((t) => !declared.has(t)))]);
  }

  private formatPreviewError(err: unknown, fallback: string): string {
    if (err instanceof ApiError) return err.message;
    return fallback;
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
  }

  private formatError(err: unknown, fallback = 'Could not load template.'): string {
    if (err instanceof ApiNotFoundError) return 'Template not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage templates.';
    if (err instanceof ApiConflictError) return 'Code conflict — pick a different code.';
    if (err instanceof ApiError) return err.message;
    return fallback;
  }
}
